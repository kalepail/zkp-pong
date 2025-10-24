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
    let width = to_fixed_int(WIDTH as i64);
    let height = to_fixed_int(HEIGHT as i64);
    let ball_radius = to_fixed_int(BALL_RADIUS as i64);
    let paddle_height = to_fixed_int(PADDLE_HEIGHT as i64);
    let paddle_width = to_fixed_int(PADDLE_WIDTH as i64);
    let paddle_margin = to_fixed_int(PADDLE_MARGIN as i64);
    let paddle_max_speed = to_fixed_int(PADDLE_MAX_SPEED as i64);
    let serve_speed = to_fixed_int(SERVE_SPEED as i64);
    let speed_increment = to_fixed_int(SPEED_INCREMENT as i64);
    let max_bounce_angle = deg_to_rad_fixed(MAX_BOUNCE_ANGLE_DEG);

    let y_min = ball_radius;
    let y_max = height - ball_radius;
    let left_face = paddle_margin + paddle_width;
    let right_face = width - (paddle_margin + paddle_width);
    let half = i_div(paddle_height, to_fixed_int(2));
    let pad_ball = half + ball_radius;
    let left_contact_x = left_face + ball_radius;
    let right_contact_x = right_face - ball_radius;

    // Serve helper
    let mut state = serve(
        INITIAL_SERVE_DIRECTION,
        to_fixed_int(0),
        width,
        height,
        serve_speed,
        MAX_BOUNCE_ANGLE_DEG,
        ANGLE_RANGE,
        SERVE_ANGLE_MULTIPLIER,
        0,
        inp.game_id,
    );

    let mut left_score: u32 = 0;
    let mut right_score: u32 = 0;

    // Event validation
    let events = &inp.events; // Vec<I>

    // Empty games are invalid - no gameplay occurred
    if events.is_empty() {
        return ValidateLogOutput::invalid("No events provided - game never started");
    }
    if events.len() > MAX_EVENTS as usize {
        return ValidateLogOutput::invalid("Too many events (exceeds MAX_EVENTS limit)");
    }
    if events.len() % 2 != 0 {
        return ValidateLogOutput::invalid("Events must be pairs");
    }

    let mut processed_events = 0u32; // Track total events processed to match log.events.length
    for pair in events.chunks_exact(2) {
        processed_events += 2; // Process two events (L, R) per iteration
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

        // Addition overflow protection provided by overflow-checks = true
        // With Q16.16 format and event limit (10,000), time overflow is mathematically impossible
        let t_hit = state.t0 + dt_to_paddle;
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
                speed_increment,
            );
            state.vx = vx;
            state.vy = vy;
            state.speed = speed;
            state.dir = dir;
        } else {
            if moving_left { right_score += 1; } else { left_score += 1; }
            if left_score >= POINTS_TO_WIN || right_score >= POINTS_TO_WIN {
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
                MAX_BOUNCE_ANGLE_DEG,
                ANGLE_RANGE,
                SERVE_ANGLE_MULTIPLIER,
                processed_events,
                inp.game_id,
            );
            next.left_y = state.left_y;
            next.right_y = state.right_y;
            state = next;
        }
    }

    // Validate final score - one player must have exactly POINTS_TO_WIN
    if left_score != POINTS_TO_WIN && right_score != POINTS_TO_WIN {
        return ValidateLogOutput::invalid("Invalid final score - neither player reached POINTS_TO_WIN");
    }

    // Reject scores beyond POINTS_TO_WIN
    if left_score > POINTS_TO_WIN || right_score > POINTS_TO_WIN {
        return ValidateLogOutput::invalid("Invalid final score - game continued beyond POINTS_TO_WIN");
    }

    // Reject ties - games must have a winner
    if left_score == right_score {
        return ValidateLogOutput::invalid("Game ended in a tie - invalid game");
    }

    // Build commitment / hash of events for binding
    let hash = compute_log_hash(events);
    ValidateLogOutput::ok(left_score, right_score, events.len() as u32, hash, inp.game_id)
}
