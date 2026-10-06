import bpy, json, math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'assets/source'
bpy.ops.wm.open_mainfile(filepath=str(OUT/'gallery-editable.blend'))
spec=json.loads((ROOT/'assets/design/model-spec.json').read_text())
layout=json.loads((ROOT/'src/data/layout.json').read_text())
byid={a['id']:a for a in spec['assets']};checks=[]
floor=bpy.data.objects['Grand hall floor'];roof=bpy.data.objects['Solid roof wing']
ceiling_height=min((roof.matrix_world @ v.co).z for v in roof.data.vertices)
assert abs(floor.dimensions.x-layout['room']['width'])<.001
assert abs(floor.dimensions.y-layout['room']['depth'])<.001
assert abs(ceiling_height-layout['room']['height'])<.001
architecture={'floor_width_m':floor.dimensions.x,'floor_depth_m':floor.dimensions.y,'ceiling_height_m':ceiling_height,'skylight_count':len(layout['architecture']['skylights'])}
for o in bpy.context.scene.objects:
    if o.type!='MESH' or 'design_part' not in o:continue
    if o.name.startswith('Canvas '):
        artwork=next(a for a in layout['artworks'] if o.name.startswith('Canvas '+a['id']+' /'))
        asset=byid['canvas'];part=next(p for p in asset['parts'] if p['name']==o['design_part']);expected=part['s'][:]
        if artwork['height']!=3.1 and not any(s in o.name for s in ['upright','foot','fixing']):expected[0]*=artwork['width']/2.35;expected[1]*=artwork['height']/3.1
    else:
        asset=byid['window'] if o.name.startswith('Window ') else next((a for a in spec['assets'] if o.name.startswith(a['id']+' /')),None)
        if not asset:continue
        part=next(p for p in asset['parts'] if p['name']==o['design_part']);expected=part['s'][:]
    bounds=[(max(v.co[k] for v in o.data.vertices)-min(v.co[k] for v in o.data.vertices))*abs(o.scale[k]) for k in range(3)]
    actual=[bounds[0],bounds[2],bounds[1]];error=max(abs(actual[k]-expected[k]) for k in range(3))
    checks.append({'part':o.name,'expected_m':expected,'actual_m':actual,'max_dimension_error_m':error,'pass':error<.001})
for c in checks:
    if not c['pass']:print('DIMENSION_MISMATCH',c,flush=True)
assert checks and all(c['pass'] for c in checks)
(ROOT/'docs/dimension-checks.json').write_text(json.dumps(checks,indent=2))
# Verify independent component editing persists after saving and reopening a fresh file.
seat=bpy.data.objects['chair / Seat'];other=bpy.data.objects['chair / Backrest'];original=other.location.copy();seat.location.x+=.02
test_path=ROOT/'artifacts/editability-test.blend';bpy.ops.wm.save_as_mainfile(filepath=str(test_path));bpy.ops.wm.open_mainfile(filepath=str(test_path))
assert abs(bpy.data.objects['chair / Seat'].location.x-(next(p['position'][0] for p in layout['props'] if p['type']=='chair')+.02))<.0001
assert (bpy.data.objects['chair / Backrest'].location-original).length<.0001
bpy.ops.wm.open_mainfile(filepath=str(OUT/'gallery.blend'))
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.name.startswith('Baked_')]
missing=[]
for o in meshes:
    for m in o.data.materials:
        for n in m.node_tree.nodes:
            if n.type=='TEX_IMAGE' and (not n.image or not n.image.packed_file):missing.append(o.name)
assert not missing
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'gallery-textured.glb'),export_format='GLB',use_selection=True,export_materials='EXPORT',export_cameras=False,export_lights=False)
report={'architecture':architecture,'checked_components':len(checks),'max_dimension_error_m':max(c['max_dimension_error_m'] for c in checks),'independent_edit_save_reopen':True,'packed_textures':not missing,'model_meshes':len(meshes),'texture_resolution':[list(m.data.materials[0].node_tree.nodes.get('Image Texture').image.size) for m in meshes]}
(ROOT/'docs/model-audit.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
