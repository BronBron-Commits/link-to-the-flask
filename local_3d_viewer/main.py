import sys
import numpy as np
from PyQt5 import QtWidgets, QtOpenGL
import moderngl
from pygltflib import GLTF2

class GLBViewerWidget(QtOpenGL.QGLWidget):
    def __init__(self, glb_path, parent=None):
        super().__init__(parent)
        self.glb_path = glb_path
        self.ctx = None
        self.model = None

    def initializeGL(self):
        self.ctx = moderngl.create_context()
        print('OpenGL context initialized')
        self.load_glb(self.glb_path)

    def load_glb(self, path):
        print(f'Loading GLB: {path}')
        gltf = GLTF2().load(path)
        print('GLB loaded:', gltf)
        if not gltf.meshes:
            print('No meshes found in GLB!')
            return
        mesh = gltf.meshes[0]
        print('Mesh:', mesh)
        # Parse buffer data for first primitive
        primitive = mesh.primitives[0]
        accessor_pos = gltf.accessors[primitive.attributes.POSITION]
        buffer_view_pos = gltf.bufferViews[accessor_pos.bufferView]
        buffer_pos = gltf.buffers[buffer_view_pos.buffer]
        data = buffer_pos.data
        # Extract vertex positions
        start = buffer_view_pos.byteOffset or 0
        end = start + buffer_view_pos.byteLength
        positions = np.frombuffer(data[start:end], dtype=np.float32)
        positions = positions.reshape((-1, 3))
        # Indices
        accessor_idx = gltf.accessors[primitive.indices]
        buffer_view_idx = gltf.bufferViews[accessor_idx.bufferView]
        buffer_idx = gltf.buffers[buffer_view_idx.buffer]
        start_idx = buffer_view_idx.byteOffset or 0
        end_idx = start_idx + buffer_view_idx.byteLength
        indices = np.frombuffer(buffer_idx.data[start_idx:end_idx], dtype=np.uint16)
        # Create VBO and IBO
        self.vbo = self.ctx.buffer(positions.astype('f4').tobytes())
        self.ibo = self.ctx.buffer(indices.astype('u2').tobytes())
        # Simple shader
        self.prog = self.ctx.program(
            vertex_shader='''
                #version 330
                in vec3 in_vert;
                void main() {
                    gl_Position = vec4(in_vert, 1.0);
                }
            ''',
            fragment_shader='''''
                #version 330
                out vec4 f_color;
                void main() {
                    f_color = vec4(0.7, 0.7, 1.0, 1.0);
                }
            '''
        )
        self.vao = self.ctx.vertex_array(
            self.prog,
            [(self.vbo, '3f', 'in_vert')] ,
            self.ibo
        )
        self.mesh_loaded = True

    def paintGL(self):
        self.ctx.clear(0.1, 0.1, 0.1)
        if hasattr(self, 'mesh_loaded') and self.mesh_loaded:
            self.vao.render()

    def resizeGL(self, w, h):
        self.ctx.viewport = (0, 0, w, h)

class MainWindow(QtWidgets.QMainWindow):
    def __init__(self, glb_path):
        super().__init__()
        self.setWindowTitle('GLB 3D Viewer')
        self.viewer = GLBViewerWidget(glb_path)
        self.setCentralWidget(self.viewer)
        self.resize(1024, 768)

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python main.py <path_to_glb>')
        sys.exit(1)
    app = QtWidgets.QApplication(sys.argv)
    window = MainWindow(sys.argv[1])
    window.show()
    sys.exit(app.exec_())
