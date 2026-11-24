//! Append-only guest tree (depth [`DEPTH`]) of commitments `C`.
//!
//! Empty leaves are `0`. Parent = `Poseidon(left, right)` (standard P128Pow5T3),
//! the same hash the circuit uses, so a root built here (backend, browser, or the
//! chain via `poseidon_hash_pallas`) is the root the proof opens against.

use crate::{p2, DEPTH};
use ff::Field;
use pasta_curves::pallas;

pub const CAPACITY: usize = 1 << DEPTH;

#[derive(Clone, Debug)]
pub struct MerklePath {
    pub index: usize,
    pub siblings: [pallas::Base; DEPTH],
    /// `bits[i]` = the running node is the RIGHT child at level i.
    pub bits: [bool; DEPTH],
}

#[derive(Clone, Debug, Default)]
pub struct GuestTree {
    leaves: Vec<pallas::Base>,
}

/// `empty[i]` = root of an empty subtree of height i.
pub fn empty_roots() -> [pallas::Base; DEPTH + 1] {
    let mut e = [pallas::Base::ZERO; DEPTH + 1];
    for i in 1..=DEPTH {
        e[i] = p2(e[i - 1], e[i - 1]);
    }
    e
}

impl GuestTree {
    pub fn new() -> Self {
        Self { leaves: vec![] }
    }

    pub fn from_leaves(leaves: Vec<pallas::Base>) -> Result<Self, String> {
        if leaves.len() > CAPACITY {
            return Err(format!("tree full: {} > {CAPACITY}", leaves.len()));
        }
        Ok(Self { leaves })
    }

    pub fn len(&self) -> usize {
        self.leaves.len()
    }

    pub fn is_empty(&self) -> bool {
        self.leaves.is_empty()
    }

    pub fn leaves(&self) -> &[pallas::Base] {
        &self.leaves
    }

    pub fn append(&mut self, c: pallas::Base) -> Result<usize, String> {
        if self.leaves.len() >= CAPACITY {
            return Err("tree full".into());
        }
        self.leaves.push(c);
        Ok(self.leaves.len() - 1)
    }

    pub fn position(&self, c: &pallas::Base) -> Option<usize> {
        self.leaves.iter().position(|x| x == c)
    }

    fn levels(&self) -> Vec<Vec<pallas::Base>> {
        let empty = empty_roots();
        let mut levels = vec![self.leaves.clone()];
        for h in 0..DEPTH {
            let cur = &levels[h];
            let mut next = Vec::with_capacity(cur.len().div_ceil(2));
            for pair in cur.chunks(2) {
                let l = pair[0];
                let r = if pair.len() == 2 { pair[1] } else { empty[h] };
                next.push(p2(l, r));
            }
            levels.push(next);
        }
        levels
    }

    pub fn root(&self) -> pallas::Base {
        if self.leaves.is_empty() {
            return empty_roots()[DEPTH];
        }
        self.levels()[DEPTH][0]
    }

    pub fn path(&self, index: usize) -> Result<MerklePath, String> {
        if index >= self.leaves.len() {
            return Err(format!("index {index} out of range ({})", self.leaves.len()));
        }
        let empty = empty_roots();
        let levels = self.levels();
        let mut siblings = [pallas::Base::ZERO; DEPTH];
        let mut bits = [false; DEPTH];
        let mut i = index;
        for h in 0..DEPTH {
            let sib = i ^ 1;
            siblings[h] = levels[h].get(sib).copied().unwrap_or(empty[h]);
            bits[h] = i & 1 == 1;
            i >>= 1;
        }
        Ok(MerklePath { index, siblings, bits })
    }
}

/// Recompute a root from a leaf and its path.
pub fn root_from_path(leaf: pallas::Base, path: &MerklePath) -> pallas::Base {
    let mut cur = leaf;
    for h in 0..DEPTH {
        cur = if path.bits[h] { p2(path.siblings[h], cur) } else { p2(cur, path.siblings[h]) };
    }
    cur
}
