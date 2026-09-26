# Genera los modelos low poly de la Batalla Naval y los exporta a .glb.
#
# Uso (dentro de Blender 4.2+ / 5.x, p. ej. via el MCP de Blender):
#   exec(open(r"<repo>/src/features/batalla-naval/assets/blender/build_models.py").read(),
#        {"__name__": "__main__", "OUT_DIR": r"<repo>/src/features/batalla-naval/assets/models"})
#
# Convenciones (las usa popup/scene/ships.js, NO cambiar sin tocar el codigo):
# - 1 unidad = 1 casilla. Blender Z-up (glTF lo pasa a Y-up). Linea de flotacion z=0.
# - Barcos: proa hacia +X, centrados en el origen. Nodos hijos de "ship":
#     seg0..seg{n-1}           seccion sana de cada casilla (seg0 = popa, la ultima = proa)
#     seg0_broken..            la misma seccion rota (casco astillado, mastil quebrado, fuego)
#     sunk                     el barco entero hundido (escorado y medio sumergido)
# - mine.glb: nodo "mine" centrado en el origen. cannonball.glb: nodo "ball".
# - Todo es geometria con sombreado plano y materiales de color solido (sin texturas).

import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

OUT_DIR = globals().get("OUT_DIR")
random.seed(1805)

# --- Escena limpia -------------------------------------------------------------

def reset_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials):
        for item in list(coll):
            if item.users == 0:
                coll.remove(item)


# --- Materiales ------------------------------------------------------------------

_MATS = {}


def mat(name, rgb, rough=0.85, emit=None):
    if name in _MATS:
        return _MATS[name]
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = 0.0
    if emit:
        for key in ("Emission Color", "Emission"):
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = (*emit, 1.0)
                break
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = 1.5
    m.diffuse_color = (*rgb, 1.0)
    _MATS[name] = m
    return m


def srgb(hexstr):
    """Hex sRGB -> lineal (lo que espera Base Color)."""
    hexstr = hexstr.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(hexstr[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


# --- Utilidades de malla -----------------------------------------------------------

class MeshBuilder:
    """Acumula vertices/caras con indice de material y los vuelca a un objeto."""

    def __init__(self):
        self.verts = []
        self.faces = []
        self.fmat = []
        self.mats = []

    def mi(self, material):
        if material not in self.mats:
            self.mats.append(material)
        return self.mats.index(material)

    def v(self, co):
        self.verts.append(Vector(co))
        return len(self.verts) - 1

    def f(self, idx, material):
        self.faces.append(tuple(idx))
        self.fmat.append(self.mi(material))

    def box(self, center, size, material, rot=None):
        cx, cy, cz = center
        sx, sy, sz = (s / 2 for s in size)
        corners = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
                   (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]
        R = rot or Matrix.Identity(3)
        ids = [self.v(Vector((cx, cy, cz)) + R @ Vector(c)) for c in corners]
        for q in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            self.f([ids[i] for i in q], material)

    def cylinder(self, base, top, radius, material, sides=6, radius_top=None):
        base, top = Vector(base), Vector(top)
        axis = (top - base).normalized()
        helper = Vector((0, 0, 1)) if abs(axis.z) < 0.9 else Vector((1, 0, 0))
        u = axis.cross(helper).normalized()
        w = axis.cross(u).normalized()
        rt = radius if radius_top is None else radius_top
        ring0, ring1 = [], []
        for i in range(sides):
            a = 2 * math.pi * i / sides
            d = u * math.cos(a) + w * math.sin(a)
            ring0.append(self.v(base + d * radius))
            ring1.append(self.v(top + d * rt))
        for i in range(sides):
            j = (i + 1) % sides
            self.f([ring0[i], ring0[j], ring1[j], ring1[i]], material)
        self.f(list(reversed(ring0)), material)
        if rt > 1e-4:
            self.f(ring1, material)

    def to_object(self, name, jitter=0.0, jitter_mask=None):
        if jitter:
            for i, co in enumerate(self.verts):
                if jitter_mask is None or jitter_mask(co):
                    co.x += random.uniform(-jitter, jitter)
                    co.y += random.uniform(-jitter, jitter)
                    co.z += random.uniform(-jitter, jitter) * 0.8
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(v) for v in self.verts], [], self.faces)
        for m in self.mats:
            me.materials.append(m)
        for poly, mi in zip(me.polygons, self.fmat):
            poly.material_index = mi
            poly.use_smooth = False
        me.validate()
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


# --- Barcos ------------------------------------------------------------------------

# Especificacion por tipo. `masts`: posicion x relativa (0 = popa, 1 = proa) y
# altura. `rig`: 'square' (velas cuadradas, navio/fragata) o 'gaff' (cangreja).
SHIPS = {
    "s4": dict(size=4, beam=0.30, hull_top=0.20, hull_bot=-0.13, stern_rise=0.10, bow_rise=0.05,
               hull=srgb("#23201d"), band=srgb("#d9a441"), rail=srgb("#5b3a22"),
               deck=srgb("#b88b5a"), ports=2,
               masts=[(0.24, 0.95), (0.52, 1.15), (0.80, 0.90)], rig="square"),
    "s3": dict(size=3, beam=0.26, hull_top=0.17, hull_bot=-0.11, stern_rise=0.07, bow_rise=0.04,
               hull=srgb("#3b2a1e"), band=srgb("#e8e2d0"), rail=srgb("#2e1f15"),
               deck=srgb("#c29863"), ports=1,
               masts=[(0.33, 0.95), (0.70, 0.80)], rig="square"),
    "s2": dict(size=2, beam=0.21, hull_top=0.14, hull_bot=-0.09, stern_rise=0.04, bow_rise=0.03,
               hull=srgb("#6b4428"), band=srgb("#8a2b22"), rail=srgb("#8a2b22"),
               deck=srgb("#caa073"), ports=0,
               masts=[(0.45, 0.85)], rig="gaff"),
}

SAIL = srgb("#efe6cf")
SAIL_BURNT = srgb("#6d6152")
MAST = srgb("#6a4a2c")
CHAR = srgb("#1c1714")
BURNT = srgb("#4a3324")
FLAME = srgb("#ff7a1a")
FLAG = srgb("#b3261e")


def hull_profile(spec, t):
    """Semi-manga y altura de cubierta en t (0 popa .. 1 proa)."""
    beam = spec["beam"]
    if t > 0.72:  # proa: se afina hasta una punta
        k = (t - 0.72) / 0.28
        half = beam * max(0.04, math.cos(k * math.pi / 2) ** 0.9)
    elif t < 0.12:  # popa: espejo (transom) algo mas angosto
        half = beam * (0.78 + 0.22 * (t / 0.12))
    else:
        half = beam
    top = spec["hull_top"] + spec["stern_rise"] * max(0.0, 1 - t / 0.22) + spec["bow_rise"] * max(0.0, (t - 0.85) / 0.15)
    return half, top


def hull_slice(mb, spec, x0, x1, L, broken=False):
    """Loft del casco entre x0 y x1 (coordenadas del barco), cerrado en ambos extremos."""
    steps = max(2, int(round((x1 - x0) / 0.2)) + 1)
    bot = spec["hull_bot"]
    band_h = 0.07
    rings = []
    for s in range(steps):
        x = x0 + (x1 - x0) * s / (steps - 1)
        t = (x + L / 2) / L
        half, top = hull_profile(spec, t)
        if broken:
            top -= random.uniform(0.02, 0.07)
        # Anillo: babor (y+) de arriba hacia abajo, quilla, estribor (y-) de abajo hacia arriba.
        pts = [
            (x, half * 0.92, top),                 # borda
            (x, half, top - band_h),               # bajo la franja
            (x, half * 0.62, bot * 0.85),          # pantoque
            (x, 0.0, bot),                         # quilla
            (x, -half * 0.62, bot * 0.85),
            (x, -half, top - band_h),
            (x, -half * 0.92, top),
        ]
        rings.append([mb.v(p) for p in pts])
    band = mat(f"band_{spec['name']}", spec["band"])
    hullm = mat(f"hull_{spec['name']}", spec["hull"])
    deck = mat(f"deck_{spec['name']}", spec["deck"]) if not broken else mat("burnt", BURNT)
    for a, b in zip(rings, rings[1:]):
        for i in range(6):
            quad = [a[i], b[i], b[i + 1], a[i + 1]]
            m = band if i in (0, 5) else hullm
            if broken and random.random() < 0.3:
                m = mat("char", CHAR)
            mb.f(quad, m)
        mb.f([a[6], b[6], b[0], a[0]], deck)  # cubierta
    # Tapas (cierran la seccion para que se vea solida al separarla).
    mb.f(list(reversed(rings[0])), deck)
    mb.f(rings[-1], deck)
    return rings


def gun_ports(mb, spec, x0, x1, L):
    if not spec["ports"]:
        return
    portm = mat("port", srgb("#111111"))
    step = 0.16
    x = x0 + step / 2
    while x < x1 - 0.05:
        t = (x + L / 2) / L
        if 0.14 < t < 0.8:
            half, top = hull_profile(spec, t)
            for row in range(spec["ports"]):
                z = top - 0.035 - row * 0.075
                for side in (1, -1):
                    mb.box((x, side * (half * 0.97 + 0.004), z), (0.05, 0.012, 0.03), portm)
        x += step


def rigging(mb, spec, mx, h, L, broken=False, sunk=False):
    """Mastil + vergas + velas en x=mx."""
    t = (mx + L / 2) / L
    _, deck_z = hull_profile(spec, t)
    mastm = mat("mast", MAST)
    sailm = mat("sail", SAIL) if not broken else mat("sail_burnt", SAIL_BURNT)
    if broken:
        stub = h * random.uniform(0.25, 0.4)
        mb.cylinder((mx, 0, deck_z - 0.02), (mx + 0.02, 0.01, deck_z + stub), 0.022, mastm, radius_top=0.012)
        if not sunk:
            # Verga caida sobre la cubierta.
            rot = Matrix.Rotation(random.uniform(-0.6, 0.6), 3, "Z")
            mb.box((mx + 0.04, 0.02, deck_z + 0.02), (0.05, spec["beam"] * 2.1, 0.02), mastm, rot)
        return
    mb.cylinder((mx, 0, deck_z - 0.02), (mx, 0, deck_z + h), 0.022, mastm, radius_top=0.013)
    top = deck_z + h
    if spec["rig"] == "square":
        tiers = [(0.30, 0.95), (0.62, 0.78), (0.88, 0.55)]
        for lo, span in tiers:
            zc = deck_z + h * lo
            width = spec["beam"] * 3.0 * span
            hgt = h * 0.24
            # Verga
            mb.box((mx, 0, zc + hgt / 2), (0.018, width * 1.08, 0.018), mastm)
            # Vela con panza hacia proa (3 columnas x 2 filas, low poly).
            cols = [-1, 0, 1]
            grid = []
            for row, zz in enumerate((zc + hgt / 2, zc - hgt / 2)):
                line = []
                for cidx in cols:
                    bulge = 0.05 * (1 - abs(cidx) * 0.6) * (0.7 if row == 0 else 1.0)
                    line.append(mb.v((mx + 0.02 + bulge, cidx * width / 2, zz)))
                grid.append(line)
            for cidx in range(2):
                mb.f([grid[0][cidx], grid[1][cidx], grid[1][cidx + 1], grid[0][cidx + 1]], sailm)
    else:
        # Cangreja (trapecio a popa del mastil) + foque triangular a proa.
        boom = spec["beam"] * 3.4
        z0, z1 = deck_z + 0.10, top - 0.08
        a = mb.v((mx - 0.02, 0, z0))
        b = mb.v((mx - boom, 0.02, z0 + 0.03))
        c = mb.v((mx - boom * 0.8, 0.03, z1 - 0.05))
        d = mb.v((mx - 0.02, 0, z1))
        mb.f([a, b, c, d], sailm)
        mb.box((mx - boom / 2, 0.01, z0), (boom, 0.016, 0.016), mastm)
        e = mb.v((mx + 0.02, 0, top - 0.1))
        g = mb.v((mx + 0.02, 0, deck_z + 0.08))
        k = mb.v((L / 2 + 0.12, 0.01, deck_z + 0.06))
        mb.f([e, g, k], sailm)
    # Gallardete en el tope.
    p0 = mb.v((mx, 0, top))
    p1 = mb.v((mx, 0, top - 0.06))
    p2 = mb.v((mx - 0.14, 0.01, top - 0.03))
    mb.f([p0, p1, p2], mat("flag", FLAG))


def bowsprit(mb, spec, L, broken=False):
    _, deck_z = hull_profile(spec, 1.0)
    length = 0.12 if broken else 0.3
    mb.cylinder((L / 2 - 0.08, 0, deck_z - 0.01), (L / 2 - 0.08 + length, 0, deck_z + length * 0.35),
                0.014, mat("mast", MAST), radius_top=0.008)


def stern_castle(mb, spec, x0, L):
    """Toldilla: cabina baja en la popa (lo que da el perfil 'de 1800')."""
    half, top = hull_profile(spec, 0.06)
    mb.box((x0 + 0.12, 0, top + 0.03), (0.18, half * 1.5, 0.06), mat(f"hull_{spec['name']}", spec["hull"]))
    for side in (1, -1):
        mb.box((x0 + 0.02, side * half * 0.45, top + 0.02), (0.02, 0.05, 0.035), mat("lamp", srgb("#f6d27a"), emit=srgb("#f6c35a")))


def flames(mb, x, spec, L, scale=1.0):
    t = (x + L / 2) / L
    _, deck_z = hull_profile(spec, t)
    fm = mat("flame", FLAME, emit=FLAME)
    for _ in range(2):
        cx = x + random.uniform(-0.12, 0.12)
        cy = random.uniform(-0.06, 0.06)
        hgt = random.uniform(0.08, 0.14) * scale
        mb.cylinder((cx, cy, deck_z - 0.03), (cx, cy, deck_z + hgt), 0.035 * scale, fm, sides=4, radius_top=0.0)


def debris(mb, x, spec, L):
    t = (x + L / 2) / L
    _, deck_z = hull_profile(spec, t)
    for _ in range(2):
        rot = Matrix.Rotation(random.uniform(0, math.pi), 3, "Z") @ Matrix.Rotation(random.uniform(-0.5, 0.5), 3, "X")
        mb.box((x + random.uniform(-0.15, 0.15), random.uniform(-0.12, 0.12), deck_z + 0.01),
               (random.uniform(0.08, 0.16), 0.025, 0.015), mat("char", CHAR), rot)


def build_segment(spec, i, broken, sunk=False):
    n = spec["size"]
    L = n * 0.94
    seg = L / n
    x0 = -L / 2 + i * seg
    x1 = x0 + seg
    mb = MeshBuilder()
    hull_slice(mb, spec, x0, x1, L, broken=broken)
    if not broken:
        gun_ports(mb, spec, x0, x1, L)
    if i == 0:
        stern_castle(mb, spec, x0, L)
    if i == n - 1:
        bowsprit(mb, spec, L, broken=broken)
    for tx, h in spec["masts"]:
        mx = -L / 2 + tx * L
        if x0 <= mx < x1:
            rigging(mb, spec, mx, h, L, broken=broken, sunk=sunk)
    if broken:
        xc = (x0 + x1) / 2
        debris(mb, xc, spec, L)
        if not sunk:
            flames(mb, xc, spec, L)
    return mb


def build_ship(key, spec, hull_override=None):
    random.seed(hash(key) & 0xFFFF)
    spec = dict(spec, name=key, **(hull_override or {}))
    root = bpy.data.objects.new("ship", None)
    bpy.context.scene.collection.objects.link(root)
    objs = [root]
    for i in range(spec["size"]):
        ob = build_segment(spec, i, broken=False).to_object(f"seg{i}")
        ob.parent = root
        objs.append(ob)
        obb = build_segment(spec, i, broken=True).to_object(
            f"seg{i}_broken", jitter=0.018, jitter_mask=lambda co: co.z > -0.02)
        obb.parent = root
        objs.append(obb)
    # Hundido: todas las secciones rotas unidas, escorado y medio sumergido.
    sunk_mb = MeshBuilder()
    for i in range(spec["size"]):
        part = build_segment(spec, i, broken=True, sunk=True)
        base = len(sunk_mb.verts)
        sunk_mb.verts.extend(part.verts)
        for face, mi in zip(part.faces, part.fmat):
            sunk_mb.f([base + k for k in face], part.mats[mi])
    sunk = sunk_mb.to_object("sunk", jitter=0.012)
    sunk.parent = root
    sunk.rotation_euler = (math.radians(24), math.radians(-7), 0)
    sunk.location = (0, 0, -0.13)
    objs.append(sunk)
    return objs


# --- Mina y bala ----------------------------------------------------------------------

def build_mine():
    random.seed(1854)
    root = bpy.data.objects.new("mine", None)
    bpy.context.scene.collection.objects.link(root)
    iron = mat("iron", srgb("#3a3f44"), rough=0.6)
    rust = mat("rust", srgb("#8a4b2a"))
    red = mat("mine_cap", srgb("#b3261e"), emit=srgb("#6a0f0a"))
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.2)
    me = bpy.data.meshes.new("mine_body")
    bm.to_mesh(me)
    bm.free()
    mb = MeshBuilder()
    for v in me.vertices:
        mb.v(v.co)
    for p in me.polygons:
        mb.f(list(p.vertices), iron if random.random() > 0.2 else rust)
    bpy.data.meshes.remove(me)
    # Puas (Hertz horns): 8 direcciones repartidas.
    dirs = [Vector(d).normalized() for d in (
        (0, 0, 1), (1, 0, 0.3), (-1, 0, 0.3), (0, 1, 0.3), (0, -1, 0.3),
        (0.7, 0.7, -0.5), (-0.7, -0.7, -0.5), (0.7, -0.7, -0.5), (-0.7, 0.7, -0.5))]
    for d in dirs:
        mb.cylinder(d * 0.17, d * 0.29, 0.03, iron, sides=5, radius_top=0.012)
    mb.cylinder(Vector((0, 0, 1)) * 0.28, Vector((0, 0, 1)) * 0.31, 0.02, red, sides=5)
    # Aro "ecuatorial" (lo que hace legible el giro).
    ring = MeshBuilder()
    ob = mb.to_object("mine_mesh")
    ob.parent = root
    for k in range(8):
        a0 = 2 * math.pi * k / 8
        a1 = 2 * math.pi * (k + 1) / 8
        p0 = Vector((math.cos(a0) * 0.205, math.sin(a0) * 0.205, 0))
        p1 = Vector((math.cos(a1) * 0.205, math.sin(a1) * 0.205, 0))
        ring.cylinder(p0, p1, 0.018, rust, sides=4)
    rob = ring.to_object("mine_ring")
    rob.parent = root
    return [root, ob, rob]


def build_ball():
    root = bpy.data.objects.new("ball", None)
    bpy.context.scene.collection.objects.link(root)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.1)
    me = bpy.data.meshes.new("ball_mesh")
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = False
    me.materials.append(mat("ball", srgb("#1b1d20"), rough=0.5))
    ob = bpy.data.objects.new("ball_mesh", me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = root
    return [root, ob]


# --- Export ------------------------------------------------------------------------------

def export(objs, filename):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    path = f"{OUT_DIR}/{filename}"
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_extras=False,
    )
    return path


GROUPS = [
    ("ship_s4.glb", lambda: build_ship("s4", SHIPS["s4"])),
    ("ship_s3.glb", lambda: build_ship("s3", SHIPS["s3"])),
    ("ship_s2a.glb", lambda: build_ship("s2a", SHIPS["s2"])),
    ("ship_s2b.glb", lambda: build_ship("s2b", SHIPS["s2"], dict(band=srgb("#2c4f8a"), rail=srgb("#2c4f8a"), hull=srgb("#54432f")))),
    ("mine.glb", build_mine),
    ("cannonball.glb", build_ball),
]


def main():
    out = []
    # Un grupo por vez en una escena limpia: asi los nodos conservan su nombre
    # exacto (sin sufijos ".001"), que es lo que busca el codigo.
    if OUT_DIR:
        for filename, builder in GROUPS:
            reset_scene()
            _MATS.clear()
            out.append(export(builder(), filename))
    # Vista previa: todo junto, una fila por grupo; secciones rotas y hundido a la derecha.
    reset_scene()
    _MATS.clear()
    for row, (_, builder) in enumerate(GROUPS):
        objs = builder()
        objs[0].location = (0, -row * 1.2, 0)
        for ob in objs[1:]:
            if ob.name.split(".")[0].endswith("_broken"):
                ob.location.x += 5.0
            elif ob.name.startswith("sunk"):
                ob.location.x += 10.0
    return out


RESULT = main()
