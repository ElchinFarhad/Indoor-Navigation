use approx::assert_relative_eq;
use arraymap::ArrayMap;
use arrsac::Arrsac;
use cv_core::nalgebra::{IsometryMatrix3, Point2, Point3, Rotation3, Translation, Vector3};
use cv_core::sample_consensus::Consensus;
use cv_core::FeatureWorldMatch;
use cv_pinhole::NormalizedKeyPoint;
use lambda_twist::LambdaTwist;
use rand::{rngs::SmallRng, SeedableRng};

const EPSILON_APPROX: f64 = 1e-6;

pub fn arrsac_manual(
    x1: f64,
    y1: f64,
    x2: f64,
    y2: f64,
    x3: f64,
    y3: f64,
    x4: f64,
    y4: f64,
) -> cv_core::WorldToCamera
//[cv_core::nalgebra::Point<f64, cv_core::nalgebra::U3>; 4]
//cv_core::WorldToCamera
{
    let mut arrsac = Arrsac::new(0.01, SmallRng::from_seed([0; 16]));

    // Define some points in camera coordinates (with z > 0).
    let camera_depth_points =
        [[x1, y1, 1.0], [x2, y2, 1.0], [x3, y3, 1.0], [x4, y4, 1.0]].map(|p| Point3::from(p));

    // // Define the camera pose.
    // let rot = Rotation3::from_euler_angles(0.1, 0.2, 0.3);
    // let trans = Translation::from(Vector3::new(0.1, 0.2, 0.3));
    // let pose = IsometryMatrix3::from_parts(trans, rot);

    // // Compute world coordinates.
    // let world_points = camera_depth_points.map(|p| pose.inverse() * p);

    let world_points = [
        Point3::new(0.0, 0.0, 0.0),
        Point3::new(0.0, 1.0, 0.0),
        Point3::new(1.0, 1.0, 0.0),
        Point3::new(1.0, 0.0, 0.0),
    ];

    // let world_points = [
    //     [0.0, 0.0, 0.0],
    //     [0.0, 1.0, 0.0],
    //     [1.0, 1.0, 0.0],
    //     [1.0, 0.0, 0.0],
    // ];

    // Compute normalized image coordinates.
    let normalized_image_coordinates = camera_depth_points.map(|p| (p / p.z).xy());

    let samples: Vec<FeatureWorldMatch<NormalizedKeyPoint>> = world_points
        .iter()
        .zip(&normalized_image_coordinates)
        .map(|(&world, &image)| FeatureWorldMatch(image.into(), world.to_homogeneous().into()))
        .collect();

    // Estimate potential poses with P3P.
    // Arrsac should use the fourth point to filter and find only one model from the 4 generated.
    let pose = arrsac
        .model(&LambdaTwist::new(), samples.iter().cloned())
        .unwrap();

    // Compare the pose to ground truth.
    // assert_relative_eq!(rot, pose.0.rotation, epsilon = EPSILON_APPROX);
    // assert_relative_eq!(trans, pose.0.translation, epsilon = EPSILON_APPROX);
    return pose;
}

pub fn endless_loop_case() {
    let mut arrsac = Arrsac::new(0.01, SmallRng::from_seed([0; 16]));
    let samples = [
        FeatureWorldMatch(
            NormalizedKeyPoint(Point2::new(0.3070512144698557, 0.19317668016026052)),
            Point3::new(1.0, 1.0, 0.0).to_homogeneous().into(),
        ),
        FeatureWorldMatch(
            NormalizedKeyPoint(Point2::new(0.3208462966353674, 0.20741702947913013)),
            Point3::new(1.0, 1.5, 0.0).to_homogeneous().into(),
        ),
        FeatureWorldMatch(
            NormalizedKeyPoint(Point2::new(0.3070512144698557, 0.19317668016026052)),
            Point3::new(3.0, 1.0, 0.0).to_homogeneous().into(),
        ),
        FeatureWorldMatch(
            NormalizedKeyPoint(Point2::new(0.3208462966353674, 0.20741702947913013)),
            Point3::new(1.0, 2.0, 0.0).to_homogeneous().into(),
        ),
        FeatureWorldMatch(
            NormalizedKeyPoint(Point2::new(0.3208462966353674, 0.20741702947913013)),
            Point3::new(2.0, 2.0, 0.0).to_homogeneous().into(),
        ),
        FeatureWorldMatch(
            NormalizedKeyPoint(Point2::new(0.3070512144698557, 0.19317668016026052)),
            Point3::new(3.0, 2.0, 0.0).to_homogeneous().into(),
        ),
        FeatureWorldMatch(
            NormalizedKeyPoint(Point2::new(0.26619553978146293, 0.15033756455213498)),
            Point3::new(1.0, 3.0, 0.0).to_homogeneous().into(),
        ),
        FeatureWorldMatch(
            NormalizedKeyPoint(Point2::new(0.3494806979265859, 0.18264329458710366)),
            Point3::new(2.0, 3.0, 0.0).to_homogeneous().into(),
        ),
        FeatureWorldMatch(
            NormalizedKeyPoint(Point2::new(0.32132193890323213, 0.15408143785084824)),
            Point3::new(3.0, 3.0, 0.0).to_homogeneous().into(),
        ),
    ];
    // Estimate potential poses with P3P.
    // Arrsac should use the fourth point to filter and find only one model from the 4 generated.
    arrsac
        .model(&LambdaTwist::new(), samples.iter().cloned())
        .unwrap();
}
