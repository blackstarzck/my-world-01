import bpy,json,math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];layout=json.loads((ROOT/'src/data/layout.json').read_text());out=ROOT/layout['sourceDirectory']
for filename in ['gallery-editable.blend','gallery-materials.blend']:
    bpy.ops.wm.open_mainfile(filepath=str(out/filename))
    for r in layout['rooms']:
        if filename=='gallery-editable.blend':
            obj=bpy.data.objects[str(r['id']).zfill(2)+' / '+r['project'].upper()]
            if obj.location.z<3.5:obj.location.z+=.7
        else:
            obj=bpy.data.objects['Room_'+str(r['id']).zfill(2)];a=math.radians(r['angle']);count=0
            for v in obj.data.vertices:
                p=obj.matrix_world@v.co;dx,dz=p.x-r['door'][0],-p.y-r['door'][1];z=-dx*math.sin(a)+dz*math.cos(a)
                if abs(z-.32)<.015 and 3.1<p.z<3.5:v.co.z+=.7;count+=1
            print('MOVED_LABEL',r['id'],count,flush=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(out/filename))
