use risc0_zkvm::guest::env;

mod fixed;
mod physics;
mod types;

use crate::fixed::*;
use crate::physics::*;
use crate::types::*;

fn main() {
    // Read full-log validation input and run integer-only validator.
    let input: ValidateLogInput = env::read();

    let out = validate_log(input);
    // Commit public output only (no secrets persisted).
    env::commit(&out);
}

fn validate_log(inp: ValidateLogInput) -> ValidateLogOutput {
    // Build fixed-point constants from integer config
    let cfg = &inp.config;

    let width = to_fixed_int(cfg.width as i128);
    let height = to_fixed_int(cfg.height as i128);
    let ball_radius = to_fixed_int(cfg.ball_radius as i128);
    let paddle_height = to_fixed_int(cfg.paddle_height as i128);
    let paddle_width = to_fixed_int(cfg.paddle_width as i128);
    let paddle_margin = to_fixed_int(cfg.paddle_margin as i128);
    let paddle_max_speed = to_fixed_int(cfg.paddle_max_speed as i128);
    let serve_speed = to_fixed_int(cfg.serve_speed as i128);
    let speed_increment = to_fixed_int(cfg.speed_increment as i128);
    let max_bounce_angle = deg_to_rad_fixed(cfg.max_bounce_angle_deg);
    let serve_max_angle = deg_to_rad_fixed(cfg.serve_max_angle_deg);
    let micro_jitter = deg_milli_to_rad_fixed(cfg.micro_jitter_milli_deg);

    let y_min = ball_radius;
    let y_max = i_sub(height, ball_radius);
    let left_face = i_add(paddle_margin, paddle_width);
    let right_face = i_sub(width, i_add(paddle_margin, paddle_width));
    let half = i_div(paddle_height, to_fixed_int(2));
    let pad_ball = i_add(half, ball_radius);
    let left_contact_x = i_add(left_face, ball_radius);
    let right_contact_x = i_sub(right_face, ball_radius);

    // RNG seeded by config
    let mut rng = LcgRng::new(cfg.seed);

    // Serve helper
    let mut state = serve(
        1, // receiverDir = +1 to start
        to_fixed_int(0),
        width,
        height,
        serve_speed,
        serve_max_angle,
        &mut rng,
    );

    let mut left_score: u32 = 0;
    let mut right_score: u32 = 0;
    let mut ended = false;

    let events = &inp.events; // Vec<I>
    if events.len() % 2 != 0 { return ValidateLogOutput::invalid("events must be pairs"); }

    for pair in events.chunks_exact(2) {
        if ended { break; }
        let l_i = pair[0];
        let r_i = pair[1];

        // Compute time to paddle plane
        let target_x = if state.dir < 0 { left_contact_x } else { right_contact_x };
        let dt_to_paddle = i_div(i_sub(target_x, state.x), state.vx);
        if !(dt_to_paddle > 0) {
            return ValidateLogOutput::invalid("Invalid kinematics");
        }
        let t_hit = i_add(state.t0, dt_to_paddle);
        let y_at_hit = reflect1d(state.y, state.vy, dt_to_paddle, y_min, y_max);

        // Reachability
        let dt = i_sub(t_hit, state.t0);
        let max_delta = i_mul(paddle_max_speed, dt);
        let d_l = i_abs(i_sub(l_i, state.left_y));
        let d_r = i_abs(i_sub(r_i, state.right_y));
        if d_l > max_delta || d_r > max_delta {
            return ValidateLogOutput::invalid("Paddle moved too fast");
        }
        // Bounds clamp check
        let clamp_l = clamp_paddle_y(l_i, half, height);
        let clamp_r = clamp_paddle_y(r_i, half, height);
        if clamp_l != l_i || clamp_r != r_i {
            return ValidateLogOutput::invalid("Paddle out of bounds");
        }

        // Hit/miss in integer domain with cast only for comparison radius bounds
        let moving_left = state.dir < 0;
        let contact = if moving_left { l_i } else { r_i };
        let hit = i_abs(i_sub(contact, y_at_hit)) <= pad_ball;

        // Advance kinematics to t_hit
        state.x = if moving_left { left_contact_x } else { right_contact_x };
        state.y = y_at_hit;
        state.t0 = t_hit;
        state.left_y = l_i;
        state.right_y = r_i;

        if hit {
            // Bounce
            let contact_y = contact;
            let (vx, vy, speed, dir) = bounce(
                &state,
                contact_y,
                half,
                ball_radius,
                max_bounce_angle,
                micro_jitter,
                speed_increment,
                &mut rng,
            );
            state.vx = vx;
            state.vy = vy;
            state.speed = speed;
            state.dir = dir;
        } else {
            if moving_left { right_score += 1; } else { left_score += 1; }
            if left_score >= cfg.points_to_win || right_score >= cfg.points_to_win {
                ended = true;
                break;
            }
            // Serve toward scorer
            let receiver_dir = if moving_left { 1 } else { -1 };
            let mut next = serve(
                receiver_dir,
                state.t0,
                width,
                height,
                serve_speed,
                serve_max_angle,
                &mut rng,
            );
            next.left_y = state.left_y;
            next.right_y = state.right_y;
            state = next;
        }
    }

    // Build commitment / hash of config + events for binding
    let hash = compute_log_hash(cfg, events);
    ValidateLogOutput::ok(left_score, right_score, events.len() as u32, hash)
}
