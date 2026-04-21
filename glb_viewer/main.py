# Minimal ModernGL + PyQt5 debug viewer

import sys
import numpy as np
from PyQt5 import QtWidgets, QtOpenGL, QtCore
import moderngl
from pygltflib import GLTF2

class GLBViewer(QtOpenGL.QGLWidget):
    def __init__(self):
        super().__init__()
        self.ctx = None
        self.triangle_prog = None
        self.triangle_vao = None
        # Origin beacon
        self.beacon_prog = None
        self.beacon_vao = None
        self.mesh_prog = None
        self.mesh_vao = None
        self.mesh_vbo = None
        self.mesh_vertex_count = 0
        self.timer = QtCore.QTimer(self)
        self.timer.timeout.connect(self.update)
        self.timer.start(16)
        # Camera state (fly mode)
        self.cam_pos = np.array([0.0, 0.0, 3.0], dtype=np.float32)
        self.cam_yaw = 0.0
        self.cam_pitch = 0.0
        self._last_mouse_pos = None
        self._mouse_button = None
        self._move_keys = set()
        self._move_speed = 0.05
        self._fast_speed = 0.15
        self._zoom = 1.0
        self.fov_deg = 60.0  # Default FOV (more natural)
        # Grid and axes state
        self.grid_prog = None
        self.grid_vaos = []  # List of (vao, color)
        self.axis_prog = None
        self.axis_vao = None
        # Test cube
        self.cube_prog = None
        self.cube_vao = None

    def setup_cube(self):
        # Cube vertices (8 corners), scaled down
        scale = 0.3
        cube_vertices = np.array([
            [-1, -1, -1],
            [ 1, -1, -1],
            [ 1,  1, -1],
            [-1,  1, -1],
            [-1, -1,  1],
            [ 1, -1,  1],
            [ 1,  1,  1],
            [-1,  1,  1],
        ], dtype=np.float32) * scale
        # 12 triangles (two per face)
        cube_indices = np.array([
            0,1,2, 2,3,0,  # back
            4,5,6, 6,7,4,  # front
            0,4,7, 7,3,0,  # left
            1,5,6, 6,2,1,  # right
            3,2,6, 6,7,3,  # top
            0,1,5, 5,4,0   # bottom
        ], dtype=np.uint32)
        vert = """
        #version 330
        in vec3 in_position;
        uniform mat4 mvp;
        void main() {
            gl_Position = mvp * vec4(in_position, 1.0);
        }
        """
        frag = """
        #version 330
        out vec4 fragColor;
        void main() {
            fragColor = vec4(0.0, 1.0, 1.0, 1.0); // cyan
        }
        """
        self.cube_prog = self.ctx.program(vertex_shader=vert, fragment_shader=frag)
        vbo = self.ctx.buffer(cube_vertices.astype('f4').tobytes())
        ibo = self.ctx.buffer(cube_indices.astype('u4').tobytes())
        self.cube_vao = self.ctx.vertex_array(self.cube_prog, [(vbo, '3f', 'in_position')], ibo)
    def __init__(self):
        super().__init__()
        self.ctx = None
        self.triangle_prog = None
        self.triangle_vao = None
        # Origin beacon
        self.beacon_prog = None
        self.beacon_vao = None
        self.mesh_prog = None
        self.mesh_vao = None
        self.mesh_vbo = None
        self.mesh_vertex_count = 0
        self.timer = QtCore.QTimer(self)
        self.timer.timeout.connect(self.update)
        self.timer.start(16)
        # Camera state (fly mode)
        self.cam_pos = np.array([0.0, 0.0, 3.0], dtype=np.float32)
        self.cam_yaw = 0.0
        self.cam_pitch = 0.0
        self._last_mouse_pos = None
        self._mouse_button = None
        self._move_keys = set()
        self._move_speed = 0.05
        self._fast_speed = 0.15
        self._zoom = 1.0
        self.fov_deg = 60.0  # Default FOV (more natural)
        # Grid and axes state
        self.grid_prog = None
        self.grid_vaos = []  # List of (vao, color)
        self.axis_prog = None
        self.axis_vao = None

    def setup_grid(self):
        # Grids for XZ (gray), YZ (blue), XY (green)
        grid_size = 10
        grid_lines = []
        grid_colors = []
        # XZ plane (Y=0, gray)
        lines = []
        for i in range(-grid_size, grid_size+1):
            lines.append([i, 0, -grid_size])
            lines.append([i, 0, grid_size])
            lines.append([-grid_size, 0, i])
            lines.append([grid_size, 0, i])
        grid_lines.append(np.array(lines, dtype=np.float32))
        grid_colors.append((0.5, 0.5, 0.5, 1.0))
        # YZ plane (X=0, blue)
        lines = []
        for i in range(-grid_size, grid_size+1):
            lines.append([0, i, -grid_size])
            lines.append([0, i, grid_size])
            lines.append([0, -grid_size, i])
            lines.append([0, grid_size, i])
        grid_lines.append(np.array(lines, dtype=np.float32))
        grid_colors.append((0.2, 0.4, 1.0, 1.0))
        # XY plane (Z=0, green)
        lines = []
        for i in range(-grid_size, grid_size+1):
            lines.append([i, -grid_size, 0])
            lines.append([i, grid_size, 0])
            lines.append([-grid_size, i, 0])
            lines.append([grid_size, i, 0])
        grid_lines.append(np.array(lines, dtype=np.float32))
        grid_colors.append((0.2, 1.0, 0.2, 1.0))
        vert = """
        #version 330
        in vec3 in_position;
        uniform mat4 mvp;
        void main() {
            gl_Position = mvp * vec4(in_position, 1.0);
        }
        """
        frag = """
        #version 330
        uniform vec4 color;
        out vec4 fragColor;
        void main() {
            fragColor = color;
        }
        """
        self.grid_prog = self.ctx.program(vertex_shader=vert, fragment_shader=frag)
        self.grid_vaos = []
        for lines, color in zip(grid_lines, grid_colors):
            vbo = self.ctx.buffer(lines.tobytes())
            vao = self.ctx.simple_vertex_array(self.grid_prog, vbo, 'in_position')
            self.grid_vaos.append((vao, color))

        # Axes (X=red, Y=green, Z=blue)
        axis_lines = np.array([
            [0,0,0], [5,0,0],   # X axis
            [0,0,0], [0,5,0],   # Y axis
            [0,0,0], [0,0,5],   # Z axis
        ], dtype=np.float32)
        axis_colors = np.array([
            [1,0,0,1], [1,0,0,1],   # X axis (red)
            [0,1,0,1], [0,1,0,1],   # Y axis (green)
            [0,0,1,1], [0,0,1,1],   # Z axis (blue)
        ], dtype=np.float32)
        axis_vert = """
        #version 330
        in vec3 in_position;
        in vec4 in_color;
        uniform mat4 mvp;
        out vec4 v_color;
        void main() {
            gl_Position = mvp * vec4(in_position, 1.0);
            v_color = in_color;
        }
        """
        axis_frag = """
        #version 330
        in vec4 v_color;
        out vec4 fragColor;
        void main() {
            fragColor = v_color;
        }
        """
        self.axis_prog = self.ctx.program(vertex_shader=axis_vert, fragment_shader=axis_frag)
        axis_vbo = self.ctx.buffer(axis_lines.tobytes())
        color_vbo = self.ctx.buffer(axis_colors.tobytes())
        self.axis_vao = self.ctx.vertex_array(
            self.axis_prog,
            [
                (axis_vbo, '3f', 'in_position'),
                (color_vbo, '4f', 'in_color'),
            ]
        )
    # ...existing code...

    def mousePressEvent(self, event):
        self._last_mouse_pos = event.pos()
        self._mouse_button = event.button()
        self.setFocus()

    def mouseMoveEvent(self, event):
        if self._last_mouse_pos is None:
            return
        dx = event.x() - self._last_mouse_pos.x()
        dy = event.y() - self._last_mouse_pos.y()
        if self._mouse_button == QtCore.Qt.RightButton:
            self.cam_yaw += dx * 0.3
            self.cam_pitch += dy * 0.3  # Invert sign for correct pitch
            # Clamp pitch to ±89° to avoid flipping
            self.cam_pitch = np.clip(self.cam_pitch, -89.0, 89.0)
        self._last_mouse_pos = event.pos()
        self.update()

    def mouseReleaseEvent(self, event):
        self._last_mouse_pos = None
        self._mouse_button = None

    def wheelEvent(self, event):
        # Middle mouse scroll: zoom (change FOV)
        if event.buttons() & QtCore.Qt.MidButton or event.modifiers() & QtCore.Qt.ControlModifier:
            delta = event.angleDelta().y() / 120
            self.fov_deg -= delta * 2.0
            self.fov_deg = np.clip(self.fov_deg, 30, 150)
            self.update()
    def keyPressEvent(self, event):
        key = event.key()
        if key == QtCore.Qt.Key_Shift:
            self._move_keys.add('shift')
        elif key == QtCore.Qt.Key_W:
            self._move_keys.add('w')
        elif key == QtCore.Qt.Key_S:
            self._move_keys.add('s')
        elif key == QtCore.Qt.Key_A:
            self._move_keys.add('a')
        elif key == QtCore.Qt.Key_D:
            self._move_keys.add('d')
        elif key == QtCore.Qt.Key_Q:
            self._move_keys.add('q')
        elif key == QtCore.Qt.Key_E:
            self._move_keys.add('e')
        self.update()

    def keyReleaseEvent(self, event):
        key = event.key()
        if key == QtCore.Qt.Key_Shift:
            self._move_keys.discard('shift')
        elif key == QtCore.Qt.Key_W:
            self._move_keys.discard('w')
        elif key == QtCore.Qt.Key_S:
            self._move_keys.discard('s')
        elif key == QtCore.Qt.Key_A:
            self._move_keys.discard('a')
        elif key == QtCore.Qt.Key_D:
            self._move_keys.discard('d')
        elif key == QtCore.Qt.Key_Q:
            self._move_keys.discard('q')
        elif key == QtCore.Qt.Key_E:
            self._move_keys.discard('e')
        self.update()

    def load_glb(self, path):
        try:
            print(f"Loading GLB: {path}")
            gltf = GLTF2().load(path)
            print("GLTF loaded.")
            if not gltf.meshes:
                print("No meshes in GLB.")
                return
            mesh = gltf.meshes[0]
            prim = mesh.primitives[0]
            if not hasattr(prim.attributes, 'POSITION'):
                print("No POSITION attribute in mesh.")
                return
            accessor = gltf.accessors[prim.attributes.POSITION]
            bv = gltf.bufferViews[accessor.bufferView]
            buf = gltf.buffers[bv.buffer]
            raw = gltf.get_data_from_buffer_uri(buf.uri)
            stride = bv.byteStride or 12
            offset = (bv.byteOffset or 0) + (accessor.byteOffset or 0)
            verts = []
            for i in range(accessor.count):
                v = np.frombuffer(raw[offset + i*stride:offset + i*stride + 12], dtype=np.float32)
                verts.append(v)
            verts = np.array(verts, dtype=np.float32)
            print(f"Loaded {len(verts)} vertices.")
            # Debug mesh bounds
            min_v = verts.min(axis=0)
            max_v = verts.max(axis=0)
            center = (min_v + max_v) / 2.0
            scale = 2.0 / (max_v - min_v).max()
            print(f"Mesh min: {min_v}, max: {max_v}, center: {center}, scale: {scale}")
            # Toggle normalization for debugging
            NORMALIZE = False
            if NORMALIZE:
                verts = (verts - center) * scale
                # Center again after scaling to ensure origin alignment
                centered = verts.mean(axis=0)
                verts = verts - centered
                print(f"Mesh normalized and recentered. New mean: {verts.mean(axis=0)}")
            else:
                verts = verts - center
                print("Mesh centered at origin, no scaling.")

            # Handle indices if present
            indices = None
            if prim.indices is not None:
                ia = gltf.accessors[prim.indices]
                ibv = gltf.bufferViews[ia.bufferView]
                ibuf = gltf.buffers[ibv.buffer]
                idata = gltf.get_data_from_buffer_uri(ibuf.uri)
                start = ibv.byteOffset or 0
                arr = idata[start:start+ibv.byteLength]
                if ia.componentType == 5123:
                    dtype = np.uint16
                elif ia.componentType == 5125:
                    dtype = np.uint32
                else:
                    dtype = np.uint8
                indices = np.frombuffer(arr, dtype=dtype)
                print(f"Loaded {len(indices)} indices.")
                self.mesh_vertex_count = len(indices)
            else:
                self.mesh_vertex_count = len(verts)
                print("No indices, using vertex count.")

            # Upload buffers
            if self.mesh_vbo:
                self.mesh_vbo.release()
            self.mesh_vbo = self.ctx.buffer(verts.astype('f4').tobytes())
            if self.mesh_vao:
                self.mesh_vao.release()
            if indices is not None:
                if hasattr(self, 'mesh_ibo') and self.mesh_ibo:
                    self.mesh_ibo.release()
                self.mesh_ibo = self.ctx.buffer(indices.tobytes())
                self.mesh_vao = self.ctx.vertex_array(self.mesh_prog, [(self.mesh_vbo, '3f', 'in_position')], self.mesh_ibo)
            else:
                self.mesh_vao = self.ctx.simple_vertex_array(self.mesh_prog, self.mesh_vbo, 'in_position')
            print("GLB mesh ready.")
        except Exception as e:
            import traceback
            print("GLB load error:", e)
            traceback.print_exc()

    def initializeGL(self):
        self.ctx = moderngl.create_context()
        # Mesh shader (red)
        vert = """
        #version 330
        in vec3 in_position;
        uniform mat4 mvp;
        void main() {
            gl_Position = mvp * vec4(in_position, 1.0);
        }
        """
        mesh_frag = """
        #version 330
        out vec4 fragColor;
        void main() {
            fragColor = vec4(1.0, 0.2, 0.2, 1.0); // red
        }
        """
        self.mesh_prog = self.ctx.program(vertex_shader=vert, fragment_shader=mesh_frag)

        # Origin beacon shader (yellow vertical line)
        beacon_frag = """
        #version 330
        out vec4 fragColor;
        void main() {
            fragColor = vec4(1.0, 1.0, 0.0, 1.0); // yellow
        }
        """
        self.beacon_prog = self.ctx.program(vertex_shader=vert, fragment_shader=beacon_frag)
        beacon_line = np.array([
            [0.0, -2.0, 0.0],
            [0.0,  2.0, 0.0],
        ], dtype=np.float32)
        beacon_vbo = self.ctx.buffer(beacon_line.tobytes())
        self.beacon_vao = self.ctx.simple_vertex_array(self.beacon_prog, beacon_vbo, 'in_position')

        # Setup grid
        self.setup_grid()
        # Setup test cube
        self.setup_cube()

    def paintGL(self):
        # --- FPS-style camera movement and look ---
        move = np.zeros(3, dtype=np.float32)
        speed = self._fast_speed if 'shift' in self._move_keys else self._move_speed
        yaw_rad = np.radians(self.cam_yaw)
        pitch_rad = np.radians(self.cam_pitch)
        world_up = np.array([0, 1, 0], dtype=np.float32)

        # --- Corrected FPS camera math (OpenGL style) ---
        # Forward (movement, flat)
        forward = np.array([
            np.sin(yaw_rad),
            0,
            -np.cos(yaw_rad)
        ], dtype=np.float32)
        forward /= np.linalg.norm(forward)

        # Look direction (camera)
        look_dir = np.array([
            np.sin(yaw_rad) * np.cos(pitch_rad),
            np.sin(pitch_rad),
            -np.cos(yaw_rad) * np.cos(pitch_rad)
        ], dtype=np.float32)
        look_dir /= np.linalg.norm(look_dir)

        # Right (flat, always horizontal, flipped for OpenGL)
        right = np.array([
            -forward[2],
            0,
            forward[0]
        ], dtype=np.float32)

        up = world_up
        if 'w' in self._move_keys:
            move += forward
        if 's' in self._move_keys:
            move -= forward
        if 'a' in self._move_keys:
            move -= right
        if 'd' in self._move_keys:
            move += right
        if 'q' in self._move_keys:
            move -= up
        if 'e' in self._move_keys:
            move += up
        if np.linalg.norm(move) > 0:
            move = move / np.linalg.norm(move)
            self.cam_pos = self.cam_pos.astype(np.float32) + move * speed

        self.ctx.clear(0.1, 0.0, 0.2)  # dark purple
        w, h = self.width(), self.height()
        self.ctx.viewport = (0, 0, w, h)

        # Robust lookat matrix (double precision, avoids drift)
        def lookat(eye, target, up):
            f = (target - eye)
            f = f / np.linalg.norm(f)
            s = np.cross(f, up)
            s = s / np.linalg.norm(s)
            u = np.cross(s, f)
            m = np.eye(4, dtype=np.float64)
            m[0, :3] = s
            m[1, :3] = u
            m[2, :3] = -f
            m[0, 3] = -np.dot(s, eye)
            m[1, 3] = -np.dot(u, eye)
            m[2, 3] = np.dot(f, eye)
            return m

        def perspective(fovy_deg, aspect, near, far):
            fovy = np.radians(fovy_deg)
            f = 1.0 / np.tan(fovy / 2)
            m = np.zeros((4, 4), dtype=np.float64)
            m[0, 0] = f / aspect
            m[1, 1] = f
            m[2, 2] = (far + near) / (near - far)
            m[2, 3] = (2 * far * near) / (near - far)
            m[3, 2] = -1
            return m

        aspect = w / h if h else 1.0
        near = 0.1  # Use a reasonable near plane for better depth precision
        far = 5000.0  # Large enough for most scenes, but not too large
        proj = perspective(self.fov_deg, aspect, near, far)
        # Camera look direction
        cam_target = self.cam_pos + look_dir
        view = lookat(self.cam_pos, cam_target, up)
        mvp = (proj @ view).astype(np.float32)

        # Draw colored grids for each axis
        if self.grid_vaos:
            for vao, color in self.grid_vaos:
                self.grid_prog['mvp'] = mvp.flatten()
                self.grid_prog['color'] = color
                vao.render(mode=moderngl.LINES)

        # Draw axes (X=red, Y=green, Z=blue)
        if self.axis_vao:
            self.axis_prog['mvp'] = mvp.flatten()
            self.axis_vao.render(mode=moderngl.LINES)

        # Draw origin beacon (vertical yellow line)
        if self.beacon_vao:
            self.beacon_prog['mvp'] = mvp.flatten()
            self.beacon_vao.render(mode=moderngl.LINES)
        # Draw mesh (red)
        if self.mesh_vao:
            self.mesh_prog['mvp'] = mvp.flatten()
            self.mesh_vao.render(moderngl.POINTS if self.mesh_vertex_count < 3 else moderngl.TRIANGLES)
        # Draw test cube (cyan)
        if self.cube_vao:
            self.cube_prog['mvp'] = mvp.flatten()
            self.cube_vao.render(mode=moderngl.TRIANGLES)

class Main(QtWidgets.QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("GLB Viewer (GLB Import)")
        self.resize(1000, 700)
        self.viewer = GLBViewer()
        # FOV slider
        self.fov_slider = QtWidgets.QSlider(QtCore.Qt.Horizontal)
        self.fov_slider.setMinimum(30)
        self.fov_slider.setMaximum(150)
        self.fov_slider.setValue(int(self.viewer.fov_deg))
        self.fov_slider.setTickInterval(10)
        self.fov_slider.setTickPosition(QtWidgets.QSlider.TicksBelow)
        self.fov_slider.valueChanged.connect(self.on_fov_changed)
        # Layout
        central = QtWidgets.QWidget()
        layout = QtWidgets.QVBoxLayout(central)
        layout.setContentsMargins(0,0,0,0)
        layout.setSpacing(0)
        layout.addWidget(self.fov_slider)
        layout.addWidget(self.viewer, 1)
        self.setCentralWidget(central)
        # Add menu for loading GLB
        open_action = QtWidgets.QAction("Open GLB", self)
        open_action.triggered.connect(self.open_file)
        menubar = self.menuBar()
        file_menu = menubar.addMenu("File")
        file_menu.addAction(open_action)

    def on_fov_changed(self, value):
        self.viewer.fov_deg = value
        self.viewer.update()

    def open_file(self):
        path, _ = QtWidgets.QFileDialog.getOpenFileName(self, 'Open GLB File', '', 'GLB Files (*.glb)')
        if path:
            self.viewer.load_glb(path)

if __name__ == "__main__":
    app = QtWidgets.QApplication(sys.argv)
    win = Main()
    win.show()
    sys.exit(app.exec_())
