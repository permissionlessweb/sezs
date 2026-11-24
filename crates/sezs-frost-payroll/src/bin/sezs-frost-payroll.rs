//! Reads one JSON object from stdin, writes one JSON object to stdout.
use sezs_frost_payroll::run_json_request;
use std::io::{self, Read};

fn main() {
    let mut buf = String::new();
    io::stdin().read_to_string(&mut buf).expect("stdin");
    let v = run_json_request(&buf);
    println!("{v}");
}
