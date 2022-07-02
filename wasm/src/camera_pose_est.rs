use arrsac::Arrsac;
use cv_core::nalgebra::{Point2, Point3};
use cv_core::sample_consensus::Consensus;
use cv_core::{FeatureWorldMatch, Pose};
use cv_pinhole::NormalizedKeyPoint;
use lambda_twist::LambdaTwist;
use rand::{rngs::SmallRng, SeedableRng};

pub fn arrsac_manual(
    x1: f64,  y1: f64,
    x2: f64,  y2: f64,
    x3: f64,  y3: f64,
    x4: f64,  y4: f64,
) -> cv_core::nalgebra::Matrix<
    f64,
    cv_core::nalgebra::U2, cv_core::nalgebra::U1,
    cv_core::nalgebra::ArrayStorage<f64, cv_core::nalgebra::U2, cv_core::nalgebra::U1>,
>
{
    let mut arrsac = Arrsac::new(0.01, SmallRng::from_seed([0; 16]));
    /*
       these are the corner of the QR-CODE as returned by the
       QR-CODE detection library
    */
    let camera_points = [[x1, y1], [x2, y2], [x3, y3], [x4, y4]];

    /*
       These are the pretended positions of those corners
       in reference system which is fixed to the QR_CODE
    */
    let world_points = [
        [0.0, 0.0, 1.0],
        [1.0, 0.0, 1.0],
        [1.0, 1.0, 1.0],
        [0.0, 1.0, 1.0],
    ];

    /*
       Here I compute the camera pose using the arrsac algorithm
    */
    let samples: Vec<FeatureWorldMatch<NormalizedKeyPoint>> = world_points
        .iter()
        .zip(&camera_points)
        .map(|(&world, &image)| {
            FeatureWorldMatch(
                Point2::from(image).into(),
                Point3::from(world).to_homogeneous().into(),
            )
        })
        .collect();

    let pose = arrsac
        .model(&LambdaTwist::new(), samples.iter().cloned())
        .unwrap()
        .homogeneous();

    /*
       Here I just check that the computed matrix
       is capable of mapping the pretended corners
       into the same pixels of the image as stated above
    */
    world_points
        .iter()
        .map(|w| (w, pose * Point3::from(*w).to_homogeneous()))
        .map(|(w, p)| (w, (p / p.z).xy()))
        .for_each(|(w, p)| println!("{:?} ==> {:?}", w, p));

    /*
       This is the center of the QR-CODE in camera coordinates
    */
    let center_hom = pose * Point3::from([0.5, 0.5, 1.0]).to_homogeneous();
    let center = (center_hom / center_hom.z).xy();
    // println!("QR-CODE center is at coordinates {:?}", center);

    return center;
}
