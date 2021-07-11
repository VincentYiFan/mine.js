#![allow(dead_code)]

use serde::{Deserialize, Serialize};

use std::collections::HashMap;

pub type TypeMap = HashMap<String, u32>;

#[derive(Debug, PartialEq, Default, Clone)]
pub struct Quaternion(pub f32, pub f32, pub f32, pub f32);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UV {
    pub start_u: f32,
    pub end_u: f32,
    pub start_v: f32,
    pub end_v: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    pub name: String,
    pub is_block: bool,
    pub is_empty: bool,
    pub is_fluid: bool,
    pub is_light: bool,
    pub is_plant: bool,
    pub is_solid: bool,
    pub is_transparent: bool,
    pub red_light_level: u32,
    pub green_light_level: u32,
    pub blue_light_level: u32,
    pub is_plantable: bool,
    pub transparent_standalone: bool,

    #[serde(default)]
    pub textures: HashMap<String, String>,
}

#[derive(Debug, Clone)]
pub struct MeshType {
    pub positions: Vec<f32>,
    pub indices: Vec<i32>,
    pub uvs: Vec<f32>,
    pub aos: Vec<i32>,
    pub lights: Vec<i32>,
}

pub type GetVoxel<'a> = &'a dyn Fn(i32, i32, i32) -> bool;
