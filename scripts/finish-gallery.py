"""Resume from the verified UV scene and completed bake images without baking again."""
import bpy, json, bmesh
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'assets/source'
bpy.ops.wm.open_mainfile(filepath=str(OUT/'gallery-materials.blend'))
scene=bpy.context.scene
objects=[bpy.data.objects[n] for n in ['Baked_Floor','Baked_Architecture','Baked_Props']]
for o in objects:
    # The floor atlas already contains the expansion joints. Exporting their nearly
    # coplanar geometry as well causes dotted double lines at grazing camera angles.
    joint_slots={i for i,m in enumerate(o.data.materials) if m and m.name=='Concrete expansion joint'}
    if joint_slots:
        bm=bmesh.new();bm.from_mesh(o.data)
        bmesh.ops.delete(bm,geom=[f for f in bm.faces if f.material_index in joint_slots],context='FACES')
        bm.to_mesh(o.data);bm.free();o.data.update()
    image=bpy.data.images.load(str(OUT/(o.name+'_clean.png')))
    m=bpy.data.materials.new(o.name+'_LightBaked');m.use_nodes=True;n=m.node_tree.nodes;n.clear()
    out=n.new('ShaderNodeOutputMaterial');em=n.new('ShaderNodeEmission');tex=n.new('ShaderNodeTexImage');tex.image=image
    m.node_tree.links.new(tex.outputs['Color'],em.inputs[0]);m.node_tree.links.new(em.outputs[0],out.inputs['Surface'])
    o.data.materials.clear();o.data.materials.append(m)
    for poly in o.data.polygons:poly.material_index=0
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.export_layout(filepath=str(OUT/(o.name+'-uv.svg')),mode='SVG',size=tuple(image.size),opacity=.2)
    bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT')
for o in objects:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/gallery.glb'),export_format='GLB',use_selection=True,export_materials='NONE',export_cameras=False,export_lights=False)
bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'gallery.blend'))
scene.cycles.samples=12;scene.render.filepath=str(ROOT/'public/gallery-poster.png');bpy.ops.render.render(write_still=True)
report={'room':json.loads((ROOT/'src/data/layout.json').read_text())['room'],'bake_sizes':[2048,4096,2048],'objects':[{'name':o.name,'vertices':len(o.data.vertices),'polygons':len(o.data.polygons),'uv_layers':len(o.data.uv_layers)} for o in objects]}
(ROOT/'docs/model-report.json').write_text(json.dumps(report,indent=2))
print('GALLERY_COMPLETE',flush=True)
