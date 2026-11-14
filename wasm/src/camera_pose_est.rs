//! Camera pose estimation from the four corners of a detected QR code.
//!
//! The QR code is a planar square of known shape, so its four corners give us
//! four 2D-3D correspondences: a Perspective-n-Point (PnP) problem. It is solved
//! with the Lambda Twist P3P solver, and ARRSAC picks the hypothesis all four
//! corners agree on.
//!
//! Reference frames
//! ----------------
//! * QR frame: origin in the centre of the code, +X towards the right edge,
//!   +Y towards the bottom edge, +Z *into* the surface the code is printed on.
//!   One unit is one side length of the code, so every distance returned here
//!   has to be multiplied by the printed size of the code to get metres.
//! * Camera frame (OpenCV convention): +X right, +Y down, +Z along the optical
//!   axis, i.e. out of the back of the phone.
//!
//! The returned pose maps QR coordinates into camera coordinates:
//! `p_camera = R * p_qr + t`.

use arrsac::Arrsac;
use cv_core::nalgebra::{Matrix3, Matrix4, Matrix6, Point2, Rotation3, Vector3, Vector4, Vector6};
use cv_core::sample_consensus::{Consensus, Estimator};
use cv_core::{FeatureWorldMatch, Pose, WorldPoint};
use cv_pinhole::NormalizedKeyPoint;
use lambda_twist::LambdaTwist;
use rand::{rngs::SmallRng, SeedableRng};

/// Corners of the QR code in its own reference frame, in the order the
/// detector reports them: top-left, top-right, bottom-right, bottom-left.
pub const QR_CORNERS: [[f64; 3]; 4] = [
    [-0.5, -0.5, 0.0],
    [0.5, -0.5, 0.0],
    [0.5, 0.5, 0.0],
    [-0.5, 0.5, 0.0],
];

/// ARRSAC inlier threshold on `1 - cos(angle)` between the observed and the
/// re-projected bearing of a corner (about half a degree).
const ARRSAC_THRESHOLD: f64 = 5e-5;

/// If the consensus pose re-projects worse than this (pixels, RMS) every P3P
/// hypothesis is checked exhaustively instead.
const GOOD_ENOUGH_PX: f64 = 1.5;

/// Pinhole camera intrinsics, in pixels.
#[derive(Debug, Clone, Copy)]
pub struct Intrinsics {
    pub fx: f64,
    pub fy: f64,
    pub cx: f64,
    pub cy: f64,
}

impl Intrinsics {
    /// Intrinsics of an ideal camera whose principal point is the image centre.
    pub fn centered(focal_px: f64, width: f64, height: f64) -> Self {
        Intrinsics {
            fx: focal_px,
            fy: focal_px,
            cx: width / 2.0,
            cy: height / 2.0,
        }
    }
}

/// Pose of a QR code relative to the camera.
#[derive(Debug, Clone)]
pub struct QrPose {
    /// Rotation taking QR coordinates to camera coordinates.
    pub rotation: Matrix3<f64>,
    /// Position of the QR centre in the camera frame, in QR side lengths.
    pub translation: Vector3<f64>,
    /// RMS re-projection error of the four corners, in pixels.
    pub reprojection_error_px: f64,
}

impl QrPose {
    /// Position of the camera expressed in the QR frame (QR side lengths).
    #[allow(dead_code)]
    pub fn camera_position(&self) -> Vector3<f64> {
        -(self.rotation.transpose() * self.translation)
    }

    /// Projects a point given in the QR frame into pixel coordinates.
    pub fn project(&self, k: &Intrinsics, p: [f64; 3]) -> Option<[f64; 2]> {
        let c = self.rotation * Vector3::new(p[0], p[1], p[2]) + self.translation;
        if c.z <= 1e-9 {
            return None;
        }
        Some([k.fx * c.x / c.z + k.cx, k.fy * c.y / c.z + k.cy])
    }
}

type Sample = FeatureWorldMatch<NormalizedKeyPoint>;

fn build_samples(corners: &[[f64; 2]; 4], k: &Intrinsics) -> Vec<Sample> {
    QR_CORNERS
        .iter()
        .zip(corners.iter())
        .map(|(world, image)| {
            // Normalise the pixel with the intrinsics so it becomes a bearing.
            let normalised = Point2::new((image[0] - k.cx) / k.fx, (image[1] - k.cy) / k.fy);
            FeatureWorldMatch(
                NormalizedKeyPoint(normalised),
                WorldPoint(Vector4::new(world[0], world[1], world[2], 1.0)),
            )
        })
        .collect()
}

/// Runs ARRSAC with the Lambda Twist P3P estimator over the corner matches.
///
/// This is the consensus step of the original implementation; it now receives
/// properly normalised bearings and reports failure instead of panicking.
pub fn arrsac_manual(samples: &[Sample]) -> Option<Matrix4<f64>> {
    let mut arrsac = Arrsac::new(ARRSAC_THRESHOLD, SmallRng::from_seed([0; 16]));
    arrsac
        .model(&LambdaTwist::new(), samples.iter().cloned())
        .map(|pose| pose.homogeneous())
}

/// Turns a homogeneous world-to-camera matrix into a scored [`QrPose`].
/// Returns `None` for poses that put a corner behind the camera.
fn score(m: &Matrix4<f64>, corners: &[[f64; 2]; 4], k: &Intrinsics) -> Option<QrPose> {
    let rotation: Matrix3<f64> = m.fixed_slice::<cv_core::nalgebra::U3, cv_core::nalgebra::U3>(0, 0).into_owned();
    let translation = Vector3::new(m[(0, 3)], m[(1, 3)], m[(2, 3)]);
    if !rotation.iter().all(|v| v.is_finite()) || !translation.iter().all(|v| v.is_finite()) {
        return None;
    }
    let mut pose = QrPose {
        rotation,
        translation,
        reprojection_error_px: 0.0,
    };
    let mut sum = 0.0;
    for (world, image) in QR_CORNERS.iter().zip(corners.iter()) {
        let p = pose.project(k, *world)?;
        sum += (p[0] - image[0]).powi(2) + (p[1] - image[1]).powi(2);
    }
    pose.reprojection_error_px = (sum / 4.0).sqrt();
    Some(pose)
}

/// Estimates the pose of a QR code from its four image corners
/// (top-left, top-right, bottom-right, bottom-left, in pixels).
pub fn estimate_pose(corners: &[[f64; 2]; 4], k: &Intrinsics) -> Option<QrPose> {
    if !(k.fx.is_finite() && k.fy.is_finite() && k.fx > 0.0 && k.fy > 0.0) {
        return None;
    }
    let samples = build_samples(corners, k);

    let mut best: Option<QrPose> = arrsac_manual(&samples).and_then(|m| score(&m, corners, k));

    let good_enough = best
        .as_ref()
        .map(|p| p.reprojection_error_px <= GOOD_ENOUGH_PX)
        .unwrap_or(false);

    if !good_enough {
        // With only four points every P3P hypothesis can be checked: solve for
        // each triplet of corners and keep whichever explains all four best.
        let solver = LambdaTwist::new();
        for skip in 0..4 {
            let triplet = samples
                .iter()
                .enumerate()
                .filter(move |(i, _)| *i != skip)
                .map(|(_, s)| *s);
            for candidate in solver.estimate(triplet) {
                if let Some(pose) = score(&candidate.homogeneous(), corners, k) {
                    let better = best
                        .as_ref()
                        .map(|b| pose.reprojection_error_px < b.reprojection_error_px)
                        .unwrap_or(true);
                    if better {
                        best = Some(pose);
                    }
                }
            }
        }
    }
    best.map(|pose| refine(pose, corners, k))
}

/// Re-projection residuals (pixels) of the four corners, or `None` if a corner
/// ends up behind the camera.
fn residuals(rotation: &Matrix3<f64>, translation: &Vector3<f64>, corners: &[[f64; 2]; 4], k: &Intrinsics) -> Option<[f64; 8]> {
    let mut out = [0.0; 8];
    for (i, (w, image)) in QR_CORNERS.iter().zip(corners.iter()).enumerate() {
        let c = rotation * Vector3::new(w[0], w[1], w[2]) + translation;
        if c.z <= 1e-9 {
            return None;
        }
        out[2 * i] = k.fx * c.x / c.z + k.cx - image[0];
        out[2 * i + 1] = k.fy * c.y / c.z + k.cy - image[1];
    }
    Some(out)
}

fn rms(r: &[f64; 8]) -> f64 {
    (r.iter().map(|v| v * v).sum::<f64>() / 4.0).sqrt()
}

/// Polishes a P3P solution with a few Gauss-Newton steps over all four corners.
///
/// P3P fits three corners exactly and leaves the whole measurement error on the
/// fourth one; minimising the re-projection error of all four spreads it out
/// and makes the pose noticeably less sensitive to pixel noise.
fn refine(pose: QrPose, corners: &[[f64; 2]; 4], k: &Intrinsics) -> QrPose {
    const STEP: f64 = 1e-6;
    let mut rotation = pose.rotation;
    let mut translation = pose.translation;
    let mut current = match residuals(&rotation, &translation, corners, k) {
        Some(r) => r,
        None => return pose,
    };

    for _ in 0..10 {
        // Numerical Jacobian w.r.t. a small rotation (axis-angle) and translation.
        let mut jacobian = [[0.0f64; 6]; 8];
        for p in 0..6 {
            let mut delta = [0.0f64; 6];
            delta[p] = STEP;
            let r2 = Rotation3::new(Vector3::new(delta[0], delta[1], delta[2])).into_inner() * rotation;
            let t2 = translation + Vector3::new(delta[3], delta[4], delta[5]);
            let moved = match residuals(&r2, &t2, corners, k) {
                Some(r) => r,
                None => return finish(pose, rotation, translation, current),
            };
            for row in 0..8 {
                jacobian[row][p] = (moved[row] - current[row]) / STEP;
            }
        }
        let mut jtj = Matrix6::<f64>::zeros();
        let mut jtr = Vector6::<f64>::zeros();
        for row in 0..8 {
            for a in 0..6 {
                jtr[a] += jacobian[row][a] * current[row];
                for b in 0..6 {
                    jtj[(a, b)] += jacobian[row][a] * jacobian[row][b];
                }
            }
        }
        for d in 0..6 {
            jtj[(d, d)] *= 1.0 + 1e-6; // tiny damping keeps the system well conditioned
        }
        let step = match jtj.lu().solve(&(-jtr)) {
            Some(s) => s,
            None => break,
        };
        let r2 = Rotation3::new(Vector3::new(step[0], step[1], step[2])).into_inner() * rotation;
        let t2 = translation + Vector3::new(step[3], step[4], step[5]);
        match residuals(&r2, &t2, corners, k) {
            Some(next) if rms(&next) < rms(&current) => {
                rotation = r2;
                translation = t2;
                current = next;
            }
            _ => break,
        }
        if step.norm() < 1e-10 {
            break;
        }
    }
    finish(pose, rotation, translation, current)
}

fn finish(original: QrPose, rotation: Matrix3<f64>, translation: Vector3<f64>, current: [f64; 8]) -> QrPose {
    let error = rms(&current);
    if error <= original.reprojection_error_px && rotation.iter().all(|v| v.is_finite()) {
        QrPose {
            rotation,
            translation,
            reprojection_error_px: error,
        }
    } else {
        original
    }
}

/// Centre of a quadrilateral as the intersection of its diagonals. For a
/// square seen in perspective this is the exact image of the square's centre.
pub fn quad_center(c: &[[f64; 2]; 4]) -> [f64; 2] {
    let (p, r) = (c[0], [c[2][0] - c[0][0], c[2][1] - c[0][1]]);
    let (q, s) = (c[1], [c[3][0] - c[1][0], c[3][1] - c[1][1]]);
    let denom = r[0] * s[1] - r[1] * s[0];
    if denom.abs() < 1e-9 {
        return [
            (c[0][0] + c[1][0] + c[2][0] + c[3][0]) / 4.0,
            (c[0][1] + c[1][1] + c[2][1] + c[3][1]) / 4.0,
        ];
    }
    let t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / denom;
    [p[0] + t * r[0], p[1] + t * r[1]]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn synth(rotation: Matrix3<f64>, translation: Vector3<f64>, k: &Intrinsics) -> [[f64; 2]; 4] {
        let pose = QrPose {
            rotation,
            translation,
            reprojection_error_px: 0.0,
        };
        let mut out = [[0.0; 2]; 4];
        for (i, w) in QR_CORNERS.iter().enumerate() {
            out[i] = pose.project(k, *w).unwrap();
        }
        out
    }

    fn check(roll: f64, pitch: f64, yaw: f64, t: [f64; 3]) {
        let k = Intrinsics::centered(520.0, 640.0, 480.0);
        let rotation = Rotation3::from_euler_angles(roll, pitch, yaw).into_inner();
        let translation = Vector3::new(t[0], t[1], t[2]);
        let corners = synth(rotation, translation, &k);
        let pose = estimate_pose(&corners, &k).expect("pose");
        assert!(pose.reprojection_error_px < 0.05, "err {}", pose.reprojection_error_px);
        assert!((pose.translation - translation).norm() < 1e-3 * translation.norm().max(1.0));
        assert!((pose.rotation - rotation).norm() < 1e-3);
    }

    #[test]
    fn recovers_frontal_pose() {
        check(0.0, 0.0, 0.0, [0.0, 0.0, 4.0]);
    }

    #[test]
    fn recovers_rotated_and_tilted_poses() {
        check(0.5, 0.1, 0.0, [0.3, -0.2, 5.0]);
        check(-0.6, 0.3, 1.2, [-1.0, 0.4, 6.0]);
        check(0.2, -0.5, -2.4, [0.6, 0.9, 3.5]);
        check(0.9, 0.0, 3.0, [0.0, 0.5, 8.0]);
    }

    #[test]
    fn camera_position_is_inverse_of_pose() {
        let k = Intrinsics::centered(500.0, 640.0, 480.0);
        // Camera 3 side lengths in front of the code, looking straight at it.
        let corners = synth(Matrix3::identity(), Vector3::new(0.0, 0.0, 3.0), &k);
        let pose = estimate_pose(&corners, &k).unwrap();
        let cam = pose.camera_position();
        assert!((cam - Vector3::new(0.0, 0.0, -3.0)).norm() < 1e-3);
    }

    #[test]
    fn tolerates_pixel_noise() {
        let k = Intrinsics::centered(520.0, 640.0, 480.0);
        let rotation = Rotation3::from_euler_angles(0.6, 0.15, 0.8).into_inner();
        let translation = Vector3::new(0.2, 0.3, 4.0);
        let mut corners = synth(rotation, translation, &k);
        let noise = [[0.4, -0.3], [-0.5, 0.2], [0.3, 0.4], [-0.2, -0.4]];
        for i in 0..4 {
            corners[i][0] += noise[i][0];
            corners[i][1] += noise[i][1];
        }
        let pose = estimate_pose(&corners, &k).expect("pose");
        assert!(pose.reprojection_error_px < 1.0);
        // The in-plane rotation (what the heading is derived from) stays accurate.
        let yaw = pose.rotation[(1, 0)].atan2(pose.rotation[(0, 0)]);
        let truth = rotation[(1, 0)].atan2(rotation[(0, 0)]);
        assert!((yaw - truth).abs() < 0.03, "yaw {} vs {}", yaw, truth);
    }

    #[test]
    fn quad_center_of_square() {
        let c = quad_center(&[[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]]);
        assert!((c[0] - 5.0).abs() < 1e-9 && (c[1] - 5.0).abs() < 1e-9);
    }
}
