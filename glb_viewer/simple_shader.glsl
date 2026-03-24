#version 330

uniform mat4 mvp;
in vec3 in_position;
void main() {
    gl_Position = mvp * vec4(in_position, 1.0);
}
// Fragment shader
#version 330
out vec4 fragColor;
void main() {
    fragColor = vec4(1.0, 0.0, 0.0, 1.0); // Red mesh
}
