"""Final higher-sample bake. Artwork media must never occlude its canvas lighting."""
import bpy, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'assets/source'
bpy.ops.wm.open_mainfile(filepath=str(OUT/'gallery-materials.blend'))
scene=bpy.context.scene
selected=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else ['Baked_Floor','Baked_Architecture','Baked_Props']
for o in scene.objects:
    if o.name.startswith('ArtworkSurface_'):o.hide_render=True
for name in ['Baked_Floor','Baked_Architecture','Baked_Props']:
    if name not in selected:continue
    o=bpy.data.objects[name];bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
    im=bpy.data.images.new(name+'_test',width=256,height=256,alpha=False)
    for m in o.data.materials:
        if m:
            n=m.node_tree.nodes.new('ShaderNodeTexImage');n.image=im;m.node_tree.nodes.active=n
    scene.cycles.samples=4;scene.render.bake.margin=4
    bpy.ops.object.bake(type='DIFFUSE',pass_filter={'COLOR','DIRECT','INDIRECT'},use_clear=True)
    im.filepath_raw=str(OUT/(name+'_test.png'));im.file_format='PNG';im.save()
    print('TEST_BAKE_COMPLETE',name,flush=True)
for name,size,samples in [('Baked_Floor',2048,64),('Baked_Architecture',4096,128),('Baked_Props',2048,128)]:
    if name not in selected:continue
    o=bpy.data.objects[name];bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
    im=bpy.data.images.new(name+'_production',width=size,height=size,alpha=False)
    for m in o.data.materials:
        if m:
            n=m.node_tree.nodes.new('ShaderNodeTexImage');n.image=im;m.node_tree.nodes.active=n
    scene.cycles.samples=samples;scene.render.bake.margin=20
    print('REFINE_START',name,samples,flush=True)
    bpy.ops.object.bake(type='DIFFUSE',pass_filter={'COLOR','DIRECT','INDIRECT'},use_clear=True)
    im.filepath_raw=str(OUT/(name+'_final.png'));im.file_format='PNG';im.save()
    print('REFINE_COMPLETE',name,flush=True)
