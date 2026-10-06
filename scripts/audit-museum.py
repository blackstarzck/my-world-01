import bpy,json,math
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[1];layout=json.loads((ROOT/'src/data/layout.json').read_text());OUT=ROOT/layout['sourceDirectory']
bpy.ops.wm.open_mainfile(filepath=str(OUT/'gallery-materials.blend'))
verts=[];faces=[]
for o in bpy.context.scene.objects:
    if o.type!='MESH':continue
    offset=len(verts);verts.extend(o.matrix_world@v.co for v in o.data.vertices);faces.extend(tuple(offset+i for i in p.vertices) for p in o.data.polygons)
tree=BVHTree.FromPolygons(verts,faces,all_triangles=False)
segments=json.loads((ROOT/'artifacts/museum-camera-segments.json').read_text());hits=[]
def v(p):return Vector((p[0],-p[2],p[1]))
for idx,(a,b) in enumerate(segments):
    start,end=v(a),v(b);direction=end-start;length=direction.length
    if length<.0001:continue
    direction.normalize()
    for offset in [Vector((0,0,0)),Vector((.15,0,0)),Vector((-.15,0,0)),Vector((0,.15,0)),Vector((0,-.15,0)),Vector((0,0,.15)),Vector((0,0,-.15))]:
        hit=tree.ray_cast(start+offset,direction,length)
        if hit[0] is not None:hits.append({'segment':idx,'from':a,'to':b,'hit':list(hit[0]),'offset':list(offset)});break
uv=[]
for name in json.loads((ROOT/'src/data/layout.json').read_text())['textureGroups']:
    o=bpy.data.objects[name];uv.append({'mesh':name,'vertices':len(o.data.vertices),'uvLayers':len(o.data.uv_layers),'inRange':all(-.001<=v<=1.001 for p in o.data.uv_layers.active.data for v in p.uv)})
entryViews=[]
for r,a in zip(layout['rooms'],layout['artworks']):
    angle=math.radians(r['angle']);start=v([r['door'][0]-math.sin(angle)*.8,2.3,r['door'][1]+math.cos(angle)*.8])
    end=v([a['position'][0]+math.sin(a['rotation'])*.4,a['position'][1],a['position'][2]+math.cos(a['rotation'])*.4]);direction=end-start;length=direction.length;direction.normalize()
    entryViews.append({'room':r['id'],'unobstructed':tree.ray_cast(start,direction,length)[0] is None})
report={'revision':layout['revision'],'cameraSegments':len(segments),'raysPerSegment':7,'collisionCount':len(hits),'collisions':hits,'entryViews':entryViews,'uv':uv}
(ROOT/'docs/model-audit.json').write_text(json.dumps(report,indent=2));print('ACTUAL_GEOMETRY_AUDIT',len(hits),'collisions',flush=True)
