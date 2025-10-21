use risc0_zkvm::guest::env;

mod constants;
mod fixed;
mod physics;
mod types;

use crate::constants::*;
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
    // Use hardcoded constants for all config values
    let width = to_fixed_int(WIDTH as i128);
    let height = to_fixed_int(HEIGHT as i128);
    let ball_radius = to_fixed_int(BALL_RADIUS as i128);
    let paddle_height = to_fixed_int(PADDLE_HEIGHT as i128);
    let paddle_width = to_fixed_int(PADDLE_WIDTH as i128);
    let paddle_margin = to_fixed_int(PADDLE_MARGIN as i128);
    let paddle_max_speed = to_fixed_int(PADDLE_MAX_SPEED as i128);
    let serve_speed = to_fixed_int(SERVE_SPEED as i128);
    let speed_increment = to_fixed_int(SPEED_INCREMENT as i128);
    let max_bounce_angle = deg_to_rad_fixed(MAX_BOUNCE_ANGLE_DEG);
    let serve_max_angle = deg_to_rad_fixed(SERVE_MAX_ANGLE_DEG);
    let micro_jitter = deg_milli_to_rad_fixed(MICRO_JITTER_MILLI_DEG);

    let y_min = ball_radius;
    let y_max = height - ball_radius;
    let left_face = paddle_margin + paddle_width;
    let right_face = width - (paddle_margin + paddle_width);
    let half = i_div(paddle_height, to_fixed_int(2));
    let pad_ball = half + ball_radius;
    let left_contact_x = left_face + ball_radius;
    let right_contact_x = right_face - ball_radius;

    // RNG seeded by log input
    let mut rng = LcgRng::new(inp.seed);

    // Serve helper
    let mut state = serve(
        INITIAL_SERVE_DIRECTION,
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

    // Event validation
    let events = &inp.events; // Vec<I>

    if events.is_empty() {
        return ValidateLogOutput::invalid("No events provided");
    }
    if events.len() > MAX_EVENTS as usize {
        return ValidateLogOutput::invalid("Too many events (exceeds MAX_EVENTS limit)");
    }
    if events.len() % 2 != 0 {
        return ValidateLogOutput::invalid("Events must be pairs");
    }

    for pair in events.chunks_exact(2) {
        if ended { break; }
        let l_i = pair[0];
        let r_i = pair[1];

        // Compute time to paddle plane
        let target_x = if state.dir < 0 { left_contact_x } else { right_contact_x };

        // Guard against division by zero (should be prevented by config validation)
        if state.vx == 0 {
            return ValidateLogOutput::invalid("Invalid velocity: vx is zero");
        }

        let dt_to_paddle = i_div(target_x - state.x, state.vx);
        if !(dt_to_paddle > 0) {
            return ValidateLogOutput::invalid("Invalid kinematics");
        }

        let t_hit = state.t0 + dt_to_paddle;

        // Time overflow detection
        // With Q32.32 format, max time is ~2^95 seconds (effectively unlimited for games)
        // Event limit (10,000) ensures this check never triggers in practice
        // Included for defense-in-depth and mathematical completeness
        if t_hit < state.t0 {
            return ValidateLogOutput::invalid("Time overflow detected");
        }
        let y_at_hit = reflect1d(state.y, state.vy, dt_to_paddle, y_min, y_max);

        // Reachability
        let dt = t_hit - state.t0;
        let max_delta = i_mul(paddle_max_speed, dt);
        let d_l = i_abs(l_i - state.left_y);
        let d_r = i_abs(r_i - state.right_y);
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
        let hit = i_abs(contact - y_at_hit) <= pad_ball;

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
            if left_score >= POINTS_TO_WIN || right_score >= POINTS_TO_WIN {
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

    // Build commitment / hash of events for binding
    let hash = compute_log_hash(events);
    ValidateLogOutput::ok(left_score, right_score, events.len() as u32, hash)
}
