# Asset Folder Structure

- assets/
  - models/      # All 3D model files (.gltf, .glb, .obj, etc.)
  - textures/    # All texture images (PNG, JPG, etc.)
  - materials/   # Material definitions (if separate or custom JSON)
  - scenes/      # Scene files (if you have multi-model scenes or .gltf/.json scene files)

## Usage
- Place each model in the models/ folder. Use subfolders for categories if needed (e.g., models/characters/, models/props/).
- Place all textures in textures/. Use subfolders for organization if desired.
- Place any custom material files in materials/.
- Place scene files in scenes/.

## Example
assets/
  models/
    tree.gltf
    house.glb
    characters/
      hero.gltf
  textures/
    tree_diffuse.png
    house_normal.jpg
  materials/
    hero_material.json
  scenes/
    village_scene.gltf
