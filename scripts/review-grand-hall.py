"""Quick light/composition study on the current editable scene before the final UV bake."""
import bpy, math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/source/gallery-editable.blend'))
scene=bpy.context.scene
scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.32
for o in scene.objects:
    if o.type!='LIGHT':continue
    o.data.energy=.85 if o.name.startswith('Afternoon') else 1800 if o.name.startswith('Window fill') else 350 if o.name.startswith('Rooflight daylight') else 600
cam=scene.camera.data;cam.sensor_fit='VERTICAL';cam.lens=cam.sensor_height/(2*math.tan(math.radians(58)/2))
scene.cycles.samples=16;scene.render.resolution_percentage=80
scene.render.filepath=str(ROOT/'assets/design/grand-hall-light-study.png');bpy.ops.render.render(write_still=True)
