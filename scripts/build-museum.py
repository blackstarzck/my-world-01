"""Build the approved D floor plan with all entrance screens removed."""
import bpy, bmesh, math, json, sys
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
L=json.loads((ROOT/'src/data/layout.json').read_text())
OUT=ROOT/L['sourceDirectory'];OUT.mkdir(exist_ok=True,parents=True)
G=json.loads((OUT/'geometry.json').read_text())
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else ['prepare']
stage=args[0]

def loc(p):return (p[0],-p[2],p[1])
def select(objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
def setcamera(p,t):
    scene.camera.location=loc(p);scene.camera.rotation_euler=(Vector(loc(t))-scene.camera.location).to_track_quat('-Z','Y').to_euler()
def normals(o):
    bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
def bevel(o,w=.025):
    select([o]);m=o.modifiers.new('Soft mineral edge','BEVEL');m.width=w;m.segments=2
    bpy.ops.object.modifier_apply(modifier=m.name)
    n=o.modifiers.new('Weighted surface normals','WEIGHTED_NORMAL');bpy.ops.object.modifier_apply(modifier=n.name)

def remove_court_roof_overlap(o):
    # The upper court wall already closes this slab edge. A second coplanar
    # face causes depth fighting in WebGL; keep the existing wall and its UVs.
    bm=bmesh.new();bm.from_mesh(o.data);covered=[]
    for f in bm.faces:
        pts=[o.matrix_world@v.co for v in f.verts]
        if not pts or min(p.z for p in pts)<4.199 or max(p.z for p in pts)>4.501:continue
        if max(p.z for p in pts)-min(p.z for p in pts)<.1:continue
        for axis in [0,1]:
            if any(all(abs(p[axis]-side*8)<.001 and abs(p[1-axis])<8.001 for p in pts) for side in [-1,1]):
                covered.append(f);break
    bmesh.ops.delete(bm,geom=covered,context='FACES_ONLY');bm.to_mesh(o.data);bm.free();o.data.update()
    print('REMOVED_COPLANAR_COURT_FACES',o.name,len(covered),flush=True)

if stage=='prepare':
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
    scene.cycles.max_bounces=5;scene.cycles.diffuse_bounces=3;scene.render.threads_mode='FIXED';scene.render.threads=10
    scene.unit_settings.system='METRIC';scene.view_settings.view_transform='Standard';scene.view_settings.look='None'
    scene.world=bpy.data.worlds.new('Daylight');scene.world.use_nodes=True
    bg=scene.world.node_tree.nodes.get('Background');bg.inputs[0].default_value=(.8,.86,1,1);bg.inputs[1].default_value=.4
    groups={name:[] for name in L['textureGroups']};art=[];skies=[];checks=[]
    def material(name,color,rough=.85,texture=True):
        m=bpy.data.materials.new(name);m.use_nodes=True;b=m.node_tree.nodes.get('Principled BSDF');b.inputs['Base Color'].default_value=(*color,1);b.inputs['Roughness'].default_value=rough
        if texture:
            tex=m.node_tree.nodes.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=13;tex.inputs['Detail'].default_value=2
            ramp=m.node_tree.nodes.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=tuple(c*.985 for c in color)+(1,);ramp.color_ramp.elements[1].color=tuple(c*1.015 for c in color)+(1,)
            m.node_tree.links.new(tex.outputs['Fac'],ramp.inputs[0]);m.node_tree.links.new(ramp.outputs[0],b.inputs['Base Color'])
            bump=m.node_tree.nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.055;bump.inputs['Distance'].default_value=.003;m.node_tree.links.new(tex.outputs['Fac'],bump.inputs['Height']);m.node_tree.links.new(bump.outputs[0],b.inputs['Normal'])
        return m
    plaster=material('Chalk and warm limestone',(.74,.73,.68))
    floor=material('Honed limestone floor',(.53,.52,.46),.76)
    stone=material('Fine travertine plinth',(.67,.64,.55))
    edge=material('Linen canvas edge',(.82,.79,.7))
    metal=material('Dark brushed bronze',(.095,.09,.069),.55,False)
    sky=material('Diffuse roof light',(.95,.96,1),1,False);b=sky.node_tree.nodes.get('Principled BSDF');b.inputs['Emission Color'].default_value=(.9,.93,1,1);b.inputs['Emission Strength'].default_value=1
    def xz(r,p):
        if r is None:return p
        a=math.radians(r['angle']);return [r['door'][0]+p[0]*math.cos(a)-p[1]*math.sin(a),r['door'][1]+p[0]*math.sin(a)+p[1]*math.cos(a)]
    def point(r,p,h):q=xz(r,p);return [q[0],h,q[1]]
    def cube(name,p,size,mat,group,rotation=0,rounding=.02):
        bpy.ops.mesh.primitive_cube_add(size=1,location=loc(p));o=bpy.context.object;o.name=name;o.dimensions=(size[0],size[2],size[1]);o.rotation_euler[2]=-rotation
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(mat)
        if rounding:bevel(o,rounding)
        group.append(o);return o
    def localcube(r,name,p,h,size,mat,group,rounding=.02):return cube(name,point(r,p,h),size,mat,group,math.radians(r['angle']),rounding)
    def extrude(name,meshes,bottom,top,mat,group,r=None,rounded=False):
        vertices=[];faces=[]
        for mesh in meshes:
            flat=[p for ring in mesh['rings'] for p in ring];n=len(flat);base=len(vertices)
            vertices += [loc(point(r,p,h)) for h in [bottom,top] for p in flat]
            for tri in mesh['triangles']:faces.append(tuple(base+i for i in reversed(tri)));faces.append(tuple(base+n+i for i in tri))
            offset=0
            for ring in mesh['rings']:
                for i in range(len(ring)):
                    a=base+offset+i;b=base+offset+(i+1)%len(ring);faces.append((a,b,b+n,a+n))
                offset+=len(ring)
        data=bpy.data.meshes.new(name);data.from_pydata(vertices,[],faces);data.update();o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);o.data.materials.append(mat);normals(o)
        if rounded:bevel(o,.018)
        group.append(o);return o
    def area(name,p,t,power,size,color=(1,.96,.87)):
        data=bpy.data.lights.new(name,'AREA');data.energy=power*.12;data.shape='DISK';data.size=size;data.color=color
        o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);o.location=loc(p);o.rotation_euler=(Vector(loc(t))-o.location).to_track_quat('-Z','Y').to_euler()
    def lettering(r,text,p,h,size,group):
        curve=bpy.data.curves.new('Gallery lettering','FONT');curve.body=text;curve.size=size;curve.align_x='CENTER';curve.extrude=.002
        o=bpy.data.objects.new(text,curve);scene.collection.objects.link(o);o.location=loc(point(r,p,h));o.rotation_euler=(math.pi/2,0,-math.radians(r['angle']));o.data.materials.append(metal);select([o]);bpy.ops.object.convert(target='MESH');group.append(bpy.context.object)
    for r in G['rooms']:
        name='Room_'+str(r['id']).zfill(2);group=groups[name];prefix=f"{name} / "
        extrude(prefix+'Limestone slab',r['floorMesh'],-.22,0,floor,group,r)
        wall=extrude(prefix+'Solid perimeter walls',r['wallMesh'],0,r['h'],plaster,group,r,True)
        checks.append({'room':r['id'],'part':'wall height','design_m':r['h'],'actual_m':wall.dimensions.z,'pass':abs(wall.dimensions.z-r['h'])<.001})
        localcube(r,prefix+'Portal lintel',[0,0],(r['h']+3.6)/2,(3.2,r['h']-3.6,.6),plaster,group)
        extrude(prefix+'Roof and aperture',r['roofMesh'],r['h'],r['h']+.35,plaster,group,r)
        # The user removed every entrance screen; the full portal stays open.
        lettering(r,str(r['id']).zfill(2)+' / '+r['project'].upper(),[0,.32],3.85,.22,group)
        # A low shadow reveal makes the tall mineral walls readable at their base.
        for i,a in enumerate(r['inner']):
            b=r['inner'][(i+1)%len(r['inner'])];mid=[(a[0]+b[0])/2,(a[1]+b[1])/2]
            if abs(mid[1])<.5:continue
            length=math.dist(a,b);angle=math.atan2(b[1]-a[1],b[0]-a[0])+math.radians(r['angle'])
            cube(prefix+'Stone skirting',point(r,mid,.1),(length,.2,.045),stone,group,angle,.008)
        a=L['artworks'][r['id']-1];w,h=a['width'],a['height'];p=r['artLocal'];cy=.65+h/2
        localcube(r,prefix+'Artwork plinth',[p[0],p[1]+.15],.225,(6,.45,1.6),stone,group,.045)
        localcube(r,prefix+'Canvas backing',p,cy,(w,h,.12),edge,group,.016)
        for xx in [-w*.3,w*.3]:localcube(r,prefix+'Rear concealed support',[p[0]+xx,p[1]-.16],cy/2,(.1,cy,.1),metal,group,.009)
        # Thin raised perimeter, all media remains outside the baked atlas.
        for xx in [-w/2+.022,w/2-.022]:localcube(r,prefix+'Canvas vertical rim',[p[0]+xx,p[1]+.066],cy,(.044,h,.045),edge,group,.006)
        for yy in [.65+.022,.65+h-.022]:localcube(r,prefix+'Canvas horizontal rim',[p[0],p[1]+.066],yy,(w,.044,.045),edge,group,.006)
        lettering(r,str(r['id']).zfill(2)+'   /   '+r['project'].upper(),[p[0],p[1]+.817],.13,.14,group)
        # Artwork is emission to preserve source colours; fit without stretching.
        image=bpy.data.images.load(str(ROOT/'assets/source'/f"{r['project']}.png"));ratio=image.size[0]/image.size[1];ih=min(h-.08,(w-.08)/ratio);iw=ih*ratio
        m=bpy.data.materials.new('Project '+r['project']);m.use_nodes=True;n=m.node_tree.nodes;n.clear();output=n.new('ShaderNodeOutputMaterial');em=n.new('ShaderNodeEmission');tex=n.new('ShaderNodeTexImage');tex.image=image;m.node_tree.links.new(tex.outputs['Color'],em.inputs[0]);m.node_tree.links.new(em.outputs[0],output.inputs[0])
        bpy.ops.mesh.primitive_plane_add(size=1,location=loc(point(r,[p[0],p[1]+.095],cy)));o=bpy.context.object;o.name='ArtworkSurface_'+r['project'];o.rotation_euler=(math.pi/2,0,-math.radians(r['angle']));o.scale=(iw,ih,1);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m);art.append(o)
        # Light wells: real apertures, deep reveals, and softly emitting sky above.
        hole=r['skylight'];c=[sum(p[k] for p in hole)/len(hole) for k in [0,1]]
        for j,pa in enumerate(hole):
            pb=hole[(j+1)%len(hole)];mid=[(pa[0]+pb[0])/2,(pa[1]+pb[1])/2];ang=math.atan2(pb[1]-pa[1],pb[0]-pa[0])+math.radians(r['angle'])
            cube(prefix+'Rooflight reveal',point(r,mid,r['h']+.28),(math.dist(pa,pb),.85,.09),stone,group,ang,.008)
        o=localcube(r,'Daylight',c,r['h']+.9,(6.1,.02,2.1),sky,skies,0);o.visible_shadow=False
        area(prefix+'Roof daylight',point(r,c,r['h']-.25),point(r,[p[0],-r['d']*.55],0),6500,6,(.9,.95,1))
        area(prefix+'Art wall wash',point(r,[p[0],p[1]+4],r['h']*.68),point(r,p,cy),2100,7)
        area(prefix+'Entrance reflected fill',point(r,[0,-2],3.4),point(r,[0,-r['d']*.65],4),1200,5)
    promenade=groups['Promenade'];extrude('Promenade / continuous floor',G['floorMesh'],-.2,0,floor,promenade)
    roof=extrude('Promenade / ring roof',G['roofMesh'],4.2,4.5,plaster,promenade)
    remove_court_roof_overlap(roof)
    # Perimeter walls leave all gallery portals and the main entrance open.
    for poly in G['corridor']:
        for ring in poly:
            for i,pa in enumerate(ring[:-1]):
                pb=ring[i+1];mid=[(pa[0]+pb[0])/2,(pa[1]+pb[1])/2];skip=False
                for r in G['rooms']:
                    x,z,w,d=r['outerBounds']
                    if x-.01<=mid[0]<=x+w+.01 and z-.01<=mid[1]<=z+d+.01 and min(abs(mid[0]-x),abs(mid[0]-x-w),abs(mid[1]-z),abs(mid[1]-z-d))<.01:skip=True
                if max(abs(mid[0]),abs(mid[1]))<8.01:skip=True
                if abs(mid[1]-27)<.01:skip=True
                if not skip:
                    length=math.dist(pa,pb)
                    if length>.03:cube('Promenade / outer enclosure',[mid[0],2.1,mid[1]],(length+.018,4.2,.18),plaster,promenade,math.atan2(pb[1]-pa[1],pb[0]-pa[0]),0)
    for i,p in enumerate([[-10,-14],[-10,0],[-10,14],[10,-14],[10,0],[10,14],[0,-10],[0,10],[10,23]]):area('Promenade daylight '+str(i),[p[0],4.05,p[1]],[p[0],0,p[1]],850,3,(1,.97,.91))
    court=groups['Court'];extrude('Court / limestone floor',G['courtFloor'],-.22,0,floor,court)
    for s in [-1,1]:
        cube('Court / upper north-south wall',[0,9.1,s*8.15],(16.6,9.8,.3),plaster,court)
        cube('Court / upper east-west wall',[s*8.15,9.1,0],(.3,9.8,16),plaster,court)
    for x in [-8.16,8.16]:
        for z in [-8.16,8.16]:cube('Court / corner pier',[x,2.1,z],(.3,4.2,.3),stone,court,.0,.015)
    for p in [-8,-4,0,4,8]:
        cube('Court / roof beam',[p,14.08,0],(.14,.3,16.3),stone,court)
        cube('Court / roof beam',[0,14.08,p],(16.3,.3,.14),stone,court)
    courtSky=sky.copy();courtSky.name='Court diffuse glazing';courtSky.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value=.25
    o=cube('Daylight',[0,14.4,0],(16,.02,16),courtSky,skies,0,0);o.visible_shadow=False
    area('Court / diffuse skylight',[0,13.85,0],[0,0,0],3000,12,(.93,.96,1))
    for i,p in enumerate([[0,-7],[7,0],[0,7],[-7,0]]):area('Court / reflected light '+str(i),[p[0],3.8,p[1]],[p[0]*1.5,1.5,p[1]*1.5],500,5,(1,.97,.91))
    # A single soft sun adds directional light without a real-time shadow cost.
    data=bpy.data.lights.new('Morning light','SUN');data.energy=1.1;data.angle=.15;o=bpy.data.objects.new('Morning light',data);scene.collection.objects.link(o);o.rotation_euler=(.42,-.35,-.5)
    camdata=bpy.data.cameras.new('Museum camera');cam=bpy.data.objects.new('Museum camera',camdata);scene.collection.objects.link(cam);scene.camera=cam;camdata.sensor_fit='VERTICAL';camdata.lens=camdata.sensor_height/(2*math.tan(math.radians(L['overview']['fov'])/2));camdata.clip_end=300
    setcamera(L['overview']['position'],L['overview']['target']);scene.render.resolution_x=1440;scene.render.resolution_y=900;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG'
    bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'gallery-editable.blend'))
    for name,objects in groups.items():
        select(objects);bpy.ops.object.join();o=bpy.context.object;o.name=name
        bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.012);bpy.ops.object.mode_set(mode='OBJECT')
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.uv.export_layout(filepath=str(OUT/(name+'-uv.svg')),mode='SVG',size=(2048,2048),opacity=.2);bpy.ops.object.mode_set(mode='OBJECT')
    select(skies);bpy.ops.object.join();bpy.context.object.name='Daylight'
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'gallery-materials.blend'))
    (ROOT/'docs/dimension-checks.json').write_text(json.dumps(checks,indent=2))
    scene.render.resolution_percentage=60;scene.cycles.samples=16;scene.render.filepath=str(OUT/'space-preview.png');bpy.ops.render.render(write_still=True)
    print('MUSEUM_PREPARED',flush=True)
elif stage=='clean-seams':
    for filename,name in [('gallery-editable.blend','Promenade / ring roof'),('gallery-materials.blend','Promenade')]:
        bpy.ops.wm.open_mainfile(filepath=str(OUT/filename))
        remove_court_roof_overlap(bpy.data.objects[name])
        if name=='Promenade':
            select([bpy.data.objects[name]]);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.uv.export_layout(filepath=str(OUT/'Promenade-uv.svg'),mode='SVG',size=(2048,2048),opacity=.2);bpy.ops.object.mode_set(mode='OBJECT')
        bpy.ops.wm.save_as_mainfile(filepath=str(OUT/filename))
elif stage in ['bake','test-bake']:
    bpy.ops.wm.open_mainfile(filepath=str(OUT/'gallery-materials.blend'));scene=bpy.context.scene
    for o in scene.objects:
        if o.name.startswith('ArtworkSurface_'):o.hide_render=True
    names=args[1:] or L['textureGroups']
    for name in names:
        o=bpy.data.objects[name];select([o])
        passes=[('test',256,4)] if stage=='test-bake' else [('test',256,4),('final',2048,24)]
        for label,size,samples in passes:
            im=bpy.data.images.new(name+'_'+label,width=size,height=size,alpha=False)
            for m in o.data.materials:
                n=m.node_tree.nodes.new('ShaderNodeTexImage');n.image=im;m.node_tree.nodes.active=n
            scene.cycles.samples=samples;scene.render.bake.margin=16 if size>256 else 3
            print('BAKE_START',name,label,flush=True);bpy.ops.object.bake(type='DIFFUSE',pass_filter={'COLOR','DIRECT','INDIRECT'},use_clear=True)
            im.filepath_raw=str(OUT/(name+'_'+label+'.png'));im.file_format='PNG';im.save();print('BAKE_DONE',name,label,flush=True)
    if stage=='test-bake':
        select([bpy.data.objects[n] for n in L['textureGroups']]+[bpy.data.objects['Daylight']])
        bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/gallery.glb'),export_format='GLB',use_selection=True,export_materials='NONE',export_cameras=False,export_lights=False)
elif stage=='finish':
    bpy.ops.wm.open_mainfile(filepath=str(OUT/'gallery-materials.blend'));scene=bpy.context.scene;objects=[]
    for name in L['textureGroups']:
        o=bpy.data.objects[name];im=bpy.data.images.load(str(OUT/(name+'_clean.png')))
        m=bpy.data.materials.new(name+'_baked');m.use_nodes=True;n=m.node_tree.nodes;n.clear();out=n.new('ShaderNodeOutputMaterial');em=n.new('ShaderNodeEmission');tex=n.new('ShaderNodeTexImage');tex.image=im;m.node_tree.links.new(tex.outputs[0],em.inputs[0]);m.node_tree.links.new(em.outputs[0],out.inputs[0]);o.data.materials.clear();o.data.materials.append(m)
        for f in o.data.polygons:f.material_index=0
        objects.append(o)
    objects.append(bpy.data.objects['Daylight']);select(objects)
    bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/gallery.glb'),export_format='GLB',use_selection=True,export_materials='NONE',export_cameras=False,export_lights=False)
    bpy.ops.export_scene.gltf(filepath=str(OUT/'gallery-textured.glb'),export_format='GLB',use_selection=True,export_cameras=False,export_lights=False)
    bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'gallery.blend'))
    scene.cycles.samples=12;scene.render.filepath=str(ROOT/'public/gallery-poster.png');bpy.ops.render.render(write_still=True)
    report={'revision':L['revision'],'rooms':len(L['rooms']),'entranceScreens':0,'bakeResolution':2048,'meshes':[{'name':o.name,'vertices':len(o.data.vertices),'faces':len(o.data.polygons),'uvLayers':len(o.data.uv_layers)} for o in objects]};(ROOT/'docs/model-report.json').write_text(json.dumps(report,indent=2));print('MUSEUM_FINISHED',flush=True)
