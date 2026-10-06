import bpy,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
layout=json.loads((ROOT/'src/data/layout.json').read_text())
OUT=ROOT/layout['sourceDirectory']
bpy.ops.wm.open_mainfile(filepath=str(OUT/'gallery.blend'))
packed=[]
for name in layout['textureGroups']:
    obj=bpy.data.objects[name]
    textures=[n.image for n in obj.data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE']
    assert len(textures)==1 and textures[0].packed_file
    assert tuple(textures[0].size)==(2048,2048)
    packed.append(textures[0].name)
p=layout['overview']['position']
assert max(abs(a-b) for a,b in zip(bpy.context.scene.camera.location,(p[0],-p[2],p[1])))<.001
bpy.ops.wm.open_mainfile(filepath=str(OUT/'gallery-editable.blend'))
parts=[o for o in bpy.context.scene.objects if o.type=='MESH']
assert not any('Entry screen' in o.name for o in parts)
roomBounds=[]
for r in layout['rooms']:
    wall=bpy.data.objects['Room_'+str(r['id']).zfill(2)+' / Solid perimeter walls']
    actual=list(wall.dimensions);expected=[r['outerBounds'][2],r['outerBounds'][3],12]
    # Rounded wall junctions can extend the bounding box by a few millimetres.
    error=max(abs(a-b) for a,b in zip(actual,expected))
    assert error<.003 and abs(actual[2]-expected[2])<.001
    roomBounds.append({'room':r['id'],'actual':actual,'expected':expected,'tolerance_m':.003,'maxDeviation_m':error,'pass':True})
room_parts={name:len([o for o in parts if o.name.startswith(name+' / ')]) for name in layout['textureGroups']}
assert all(n>1 for n in room_parts.values())
report={'revision':layout['revision'],'reopenedFinalSource':True,'packedBakes':packed,'entranceScreens':0,'roomBounds':roomBounds,'cameraMatchesLayout':True,'editableMeshParts':len(parts),'partsPerGroup':room_parts}
(ROOT/'docs/source-check.json').write_text(json.dumps(report,indent=2))
print('SOURCE_VERIFIED',len(packed),'packed lightmaps;',len(parts),'editable parts',flush=True)
