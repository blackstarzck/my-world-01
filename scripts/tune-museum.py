import bpy, sys, json, math
from mathutils import Vector
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/json.loads((ROOT/'src/data/layout.json').read_text())['sourceDirectory']
factor=float(sys.argv[-1])
overview=json.loads((ROOT/'src/data/layout.json').read_text())['overview']
for file in ['gallery-editable.blend','gallery-materials.blend']:
    bpy.ops.wm.open_mainfile(filepath=str(OUT/file))
    for o in bpy.context.scene.objects:
        if o.type=='LIGHT' and o.data.type=='AREA':o.data.energy*=factor
    camera=bpy.context.scene.camera
    p=overview['position'];t=overview['target'];camera.location=(p[0],-p[2],p[1]);camera.rotation_euler=(Vector((t[0],-t[2],t[1]))-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.lens=camera.data.sensor_height/(2*math.tan(math.radians(overview['fov'])/2))
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/file))
scene=bpy.context.scene;scene.cycles.samples=16;scene.render.resolution_percentage=60;scene.render.filepath=str(OUT/'space-preview.png');bpy.ops.render.render(write_still=True)
