//! The `sezs_consume_v2` Halo2 circuit and the holder-side witness.

use crate::{p2, p3, tables, DOMAIN, EVENT_ID, NULLIFIER, NUM_PUBLIC, RK_X, RK_Y, ROOT};
use ff::{Field, FromUniformBytes, PrimeField};
use group::{Curve, GroupEncoding};
use halo2_gadgets::{
    ecc::{
        chip::{BaseFieldElem, CircuitVersion, EccChip, EccConfig, FixedPoint, FullScalar, ShortScalar, H},
        FixedPoint as FixedPointGadget, FixedPointBaseField, FixedPoints, ScalarFixed,
    },
    poseidon::{
        primitives::{ConstantLength, P128Pow5T3},
        Hash as PoseidonHash, Pow5Chip, Pow5Config,
    },
    utilities::lookup_range_check::{LookupRangeCheck, LookupRangeCheckConfig},
};
use halo2_proofs::{
    circuit::{AssignedCell, Layouter, SimpleFloorPlanner, Value},
    plonk::{self, Advice, Column, ConstraintSystem, Error, Expression, Fixed, Instance, Selector, TableColumn},
    poly::Rotation,
};
use pasta_curves::{
    arithmetic::{CurveAffine, Coordinates},
    pallas,
};
use std::sync::OnceLock;

/// Domain tag for the ticket authorising key `ask`.
pub fn ak_tag() -> pallas::Base {
    static T: OnceLock<pallas::Base> = OnceLock::new();
    *T.get_or_init(|| {
        // Packed 16-byte domain tag for ask ("sezs-ticket-ak-v2" does not fit).
        let mut b = [0u8; 32];
        b[..16].copy_from_slice(b"sezs-ticket-akv2");
        pallas::Base::from_repr(b).unwrap()
    })
}

fn us(v: &[(u64, [pallas::Base; H])]) -> Vec<[[u8; 32]; H]> {
    v.iter().map(|(_, u)| core::array::from_fn(|i| u[i].to_repr())).collect()
}

#[derive(Debug, Eq, PartialEq, Clone)]
pub struct TicketBases;
#[derive(Debug, Eq, PartialEq, Clone)]
pub struct AuthFull;
#[derive(Debug, Eq, PartialEq, Clone)]
pub struct AuthBase;
#[derive(Debug, Eq, PartialEq, Clone)]
pub struct AuthShort;

impl FixedPoint<pallas::Affine> for AuthFull {
    type FixedScalarKind = FullScalar;
    fn generator(&self) -> pallas::Affine {
        tables::spend_auth_g()
    }
    fn u(&self) -> Vec<[[u8; 32]; H]> {
        us(tables::full())
    }
    fn z(&self) -> Vec<u64> {
        tables::full().iter().map(|(z, _)| *z).collect()
    }
}
impl FixedPoint<pallas::Affine> for AuthBase {
    type FixedScalarKind = BaseFieldElem;
    fn generator(&self) -> pallas::Affine {
        tables::spend_auth_g()
    }
    fn u(&self) -> Vec<[[u8; 32]; H]> {
        us(tables::full())
    }
    fn z(&self) -> Vec<u64> {
        tables::full().iter().map(|(z, _)| *z).collect()
    }
}
impl FixedPoint<pallas::Affine> for AuthShort {
    type FixedScalarKind = ShortScalar;
    fn generator(&self) -> pallas::Affine {
        tables::spend_auth_g()
    }
    fn u(&self) -> Vec<[[u8; 32]; H]> {
        us(tables::short())
    }
    fn z(&self) -> Vec<u64> {
        tables::short().iter().map(|(z, _)| *z).collect()
    }
}
impl FixedPoints<pallas::Affine> for TicketBases {
    type FullScalar = AuthFull;
    type ShortScalar = AuthShort;
    type Base = AuthBase;
}

/// Holder-side values. `bits[i] = true` means the running node is the RIGHT child at level i.
#[derive(Clone, Debug)]
pub struct Witness<const D: usize> {
    pub secret: pallas::Base,
    pub sku: pallas::Base,
    pub event_id: pallas::Base,
    pub domain: pallas::Base,
    pub siblings: [pallas::Base; D],
    pub bits: [bool; D],
    pub alpha: pallas::Scalar,
}

/// `ask = Poseidon(AK_TAG, secret, domain)` as a Pallas scalar (p < q, so the repr is valid).
pub fn ask(secret: pallas::Base, domain: pallas::Base) -> pallas::Scalar {
    let a = p3(ak_tag(), secret, domain);
    pallas::Scalar::from_repr(a.to_repr()).unwrap()
}

/// `rk` from `rsk`.
pub fn rk_point(rsk: &pallas::Scalar) -> pallas::Affine {
    (pallas::Point::from(tables::spend_auth_g()) * rsk).to_affine()
}

/// Affine coordinates of a non-identity point.
pub fn xy(p: &pallas::Affine) -> (pallas::Base, pallas::Base) {
    let c = Option::<Coordinates<pallas::Affine>>::from(p.coordinates()).expect("rk is never identity");
    (*c.x(), *c.y())
}

/// 32-byte RedPallas verification key from affine coordinates:
/// `x` little-endian with the parity of `y` in the top bit. Pure byte work; no curve math.
pub fn rk_bytes_from_xy(x_le: &[u8; 32], y_le: &[u8; 32]) -> [u8; 32] {
    let mut out = *x_le;
    out[31] |= (y_le[0] & 1) << 7;
    out
}

impl<const D: usize> Witness<D> {
    pub fn leaf(&self) -> pallas::Base {
        p3(self.secret, self.sku, self.event_id)
    }
    pub fn root(&self) -> pallas::Base {
        let mut cur = self.leaf();
        for i in 0..D {
            cur = if self.bits[i] { p2(self.siblings[i], cur) } else { p2(cur, self.siblings[i]) };
        }
        cur
    }
    pub fn nullifier(&self) -> pallas::Base {
        p2(self.secret, self.event_id)
    }
    pub fn ask(&self) -> pallas::Scalar {
        ask(self.secret, self.domain)
    }
    pub fn rsk(&self) -> pallas::Scalar {
        self.ask() + self.alpha
    }
    pub fn rk(&self) -> pallas::Affine {
        rk_point(&self.rsk())
    }
    pub fn public_inputs(&self) -> [pallas::Base; NUM_PUBLIC] {
        let (x, y) = xy(&self.rk());
        let mut pi = [pallas::Base::ZERO; NUM_PUBLIC];
        pi[ROOT] = self.root();
        pi[NULLIFIER] = self.nullifier();
        pi[EVENT_ID] = self.event_id;
        pi[DOMAIN] = self.domain;
        pi[RK_X] = x;
        pi[RK_Y] = y;
        pi
    }
    pub fn circuit(&self) -> ConsumeV2<D> {
        ConsumeV2 {
            secret: Value::known(self.secret),
            sku: Value::known(self.sku),
            siblings: self.siblings.map(Value::known),
            bits: self.bits.map(|b| Value::known(if b { pallas::Base::ONE } else { pallas::Base::ZERO })),
            alpha: Value::known(self.alpha),
        }
    }
}

/// Sanity: `rk_bytes_from_xy` equals the compressed point encoding.
pub fn rk_compressed(p: &pallas::Affine) -> [u8; 32] {
    p.to_bytes()
}

#[derive(Clone, Debug)]
pub struct ConsumeV2<const D: usize> {
    pub secret: Value<pallas::Base>,
    pub sku: Value<pallas::Base>,
    pub siblings: [Value<pallas::Base>; D],
    pub bits: [Value<pallas::Base>; D],
    pub alpha: Value<pallas::Scalar>,
}

impl<const D: usize> ConsumeV2<D> {
    pub fn empty() -> Self {
        Self {
            secret: Value::unknown(),
            sku: Value::unknown(),
            siblings: [Value::unknown(); D],
            bits: [Value::unknown(); D],
            alpha: Value::unknown(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct Config {
    primary: Column<Instance>,
    advices: [Column<Advice>; 10],
    q_swap: Selector,
    table_idx: TableColumn,
    poseidon: Pow5Config<pallas::Base, 3, 2>,
    ecc: EccConfig<TicketBases>,
}

type Cell = AssignedCell<pallas::Base, pallas::Base>;

fn hash<const L: usize>(
    cfg: &Pow5Config<pallas::Base, 3, 2>,
    mut layouter: impl Layouter<pallas::Base>,
    msg: [Cell; L],
) -> Result<Cell, Error> {
    let h = PoseidonHash::<_, _, P128Pow5T3, ConstantLength<L>, 3, 2>::init(
        Pow5Chip::construct(cfg.clone()),
        layouter.namespace(|| "init"),
    )?;
    h.hash(layouter.namespace(|| "hash"), msg)
}

impl<const D: usize> plonk::Circuit<pallas::Base> for ConsumeV2<D> {
    type Config = Config;
    type FloorPlanner = SimpleFloorPlanner;

    fn without_witnesses(&self) -> Self {
        Self::empty()
    }

    fn configure(meta: &mut ConstraintSystem<pallas::Base>) -> Config {
        let advices: [Column<Advice>; 10] = core::array::from_fn(|_| meta.advice_column());
        for a in advices.iter() {
            meta.enable_equality(*a);
        }
        let primary = meta.instance_column();
        meta.enable_equality(primary);
        let table_idx = meta.lookup_table_column();
        let lagrange: [Column<Fixed>; 8] = core::array::from_fn(|_| meta.fixed_column());
        meta.enable_constant(lagrange[0]);
        let rc_a = [lagrange[2], lagrange[3], lagrange[4]];
        let rc_b = [lagrange[5], lagrange[6], lagrange[7]];
        let range_check = LookupRangeCheckConfig::configure(meta, advices[9], table_idx);
        let ecc = EccChip::<TicketBases>::configure(meta, advices, lagrange, range_check);
        let poseidon =
            Pow5Chip::configure::<P128Pow5T3>(meta, [advices[6], advices[7], advices[8]], advices[5], rc_a, rc_b);
        let q_swap = meta.selector();
        meta.create_gate("merkle swap", |meta| {
            let q = meta.query_selector(q_swap);
            let cur = meta.query_advice(advices[0], Rotation::cur());
            let sib = meta.query_advice(advices[1], Rotation::cur());
            let bit = meta.query_advice(advices[2], Rotation::cur());
            let left = meta.query_advice(advices[3], Rotation::cur());
            let right = meta.query_advice(advices[4], Rotation::cur());
            let one = Expression::Constant(pallas::Base::ONE);
            vec![
                q.clone() * bit.clone() * (one - bit.clone()),
                q.clone() * (left - (cur.clone() + bit.clone() * (sib.clone() - cur.clone()))),
                q * (right - (sib.clone() + bit * (cur - sib))),
            ]
        });
        Config { primary, advices, q_swap, table_idx, poseidon, ecc }
    }

    fn synthesize(&self, config: Config, mut layouter: impl Layouter<pallas::Base>) -> Result<(), Error> {
        // 10-bit range-check table (Orchard loads this from the Sinsemilla generator table).
        layouter.assign_table(
            || "table_idx",
            |mut table| {
                for i in 0..(1usize << 10) {
                    table.assign_cell(|| "idx", config.table_idx, i, || Value::known(pallas::Base::from(i as u64)))?;
                }
                Ok(())
            },
        )?;
        let ecc = EccChip::construct(config.ecc.clone(), CircuitVersion::AnchoredBase);
        let a = config.advices;

        let (secret, sku, event_id, domain, tag) = layouter.assign_region(
            || "load",
            |mut region| {
                let secret = region.assign_advice(|| "secret", a[0], 0, || self.secret)?;
                let sku = region.assign_advice(|| "sku", a[1], 0, || self.sku)?;
                let event_id = region.assign_advice_from_instance(|| "event_id", config.primary, EVENT_ID, a[2], 0)?;
                let domain = region.assign_advice_from_instance(|| "domain", config.primary, DOMAIN, a[3], 0)?;
                let tag = region.assign_advice_from_constant(|| "tag", a[4], 0, ak_tag())?;
                Ok((secret, sku, event_id, domain, tag))
            },
        )?;

        // 1. leaf C
        let mut cur =
            hash::<3>(&config.poseidon, layouter.namespace(|| "leaf"), [secret.clone(), sku, event_id.clone()])?;
        // 2. Merkle path
        for i in 0..D {
            let (left, right) = layouter.assign_region(
                || format!("swap {i}"),
                |mut region| {
                    config.q_swap.enable(&mut region, 0)?;
                    let c = cur.copy_advice(|| "cur", &mut region, a[0], 0)?;
                    let s = region.assign_advice(|| "sib", a[1], 0, || self.siblings[i])?;
                    let b = region.assign_advice(|| "bit", a[2], 0, || self.bits[i])?;
                    let lv = c
                        .value()
                        .zip(s.value())
                        .zip(b.value())
                        .map(|((c, s), b)| if *b == pallas::Base::ONE { *s } else { *c });
                    let rv = c
                        .value()
                        .zip(s.value())
                        .zip(b.value())
                        .map(|((c, s), b)| if *b == pallas::Base::ONE { *c } else { *s });
                    let l = region.assign_advice(|| "left", a[3], 0, || lv)?;
                    let r = region.assign_advice(|| "right", a[4], 0, || rv)?;
                    Ok((l, r))
                },
            )?;
            cur = hash::<2>(&config.poseidon, layouter.namespace(|| format!("node {i}")), [left, right])?;
        }
        layouter.constrain_instance(cur.cell(), config.primary, ROOT)?;
        // 3. nullifier
        let n = hash::<2>(&config.poseidon, layouter.namespace(|| "nf"), [secret.clone(), event_id])?;
        layouter.constrain_instance(n.cell(), config.primary, NULLIFIER)?;
        // 4. ask → ak → rk = ak + [alpha]G
        let ask = hash::<3>(&config.poseidon, layouter.namespace(|| "ask"), [tag, secret, domain])?;
        let ak = FixedPointBaseField::from_inner(ecc.clone(), AuthBase).mul(layouter.namespace(|| "ak"), ask)?;
        let alpha = ScalarFixed::new(ecc.clone(), layouter.namespace(|| "alpha"), self.alpha)?;
        let (alpha_g, _) =
            FixedPointGadget::from_inner(ecc.clone(), AuthFull).mul(layouter.namespace(|| "alpha G"), alpha)?;
        let rk = alpha_g.add(layouter.namespace(|| "rk"), &ak)?;
        layouter.constrain_instance(rk.inner().x().cell(), config.primary, RK_X)?;
        layouter.constrain_instance(rk.inner().y().cell(), config.primary, RK_Y)?;
        Ok(())
    }
}

/// Random scalar from any rand 0.10 RNG.
pub fn random_scalar<R: rand_core::Rng + ?Sized>(rng: &mut R) -> pallas::Scalar {
    let mut wide = [0u8; 64];
    rng.fill_bytes(&mut wide);
    pallas::Scalar::from_uniform_bytes(&wide)
}
