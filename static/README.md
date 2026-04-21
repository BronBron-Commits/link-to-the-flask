Static asset layout

Problem

The static root currently mixes app code, third-party libraries, scenes, models, textures, audio, documents, and user-uploaded content. That makes asset discovery, caching, migration, and cleanup harder than it needs to be.

Target layout

- app/: first-party frontend code owned by this repo
- vendor/: third-party browser libraries checked into the repo
- models/: curated models and reusable scene assets shipped with the app
- scenes/: scene entry assets when they are not reusable shared models
- textures/: shared texture libraries and material maps
- audio/: music, ambience, and sound effects
- shaders/: shader sources
- user_models/: temporary local upload storage only
- utils/: first-party shared runtime helpers

Rules

- New first-party JS modules go under app/ or utils/, not in the root.
- New vendor libraries go under vendor/ or an existing vendor subtree like three-addons/.
- New shipped GLB, GLTF, and FBX assets go under models/ or scenes/.
- Keep GLTF bundles self-contained in a folder that preserves relative sidecar paths.
- Do not add user-generated assets to git-tracked curated folders.
- Avoid putting new binary assets directly in the static root.

Migration policy

- Existing root-level files stay valid until their references are updated.
- New work should use the target layout immediately.
- Asset discovery already supports static/models/** and static/scenes/** in addition to legacy root files.

Recommended next cleanup passes

1. Move first-party JS entrypoints into app/ and update template references.
2. Move shipped 3D assets into models/shared/ and scenes/.
3. Move loose audio into audio/music/ and audio/sfx/.
4. Move checked-in third-party files into vendor/three/ where practical.
5. Remove non-runtime documents and source-art leftovers from static/.