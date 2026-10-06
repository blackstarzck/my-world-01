"""Reproducible Blender scene. Run in a separate background process, never the live session."""
import bpy, math, json, os, sys, time
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
LAYOUT=json.loads((ROOT/'src/data/layout.json').read_text())
SPEC=json.loads((ROOT/'assets/design/model-spec.json').read_text())
ARGS=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
STAGE=ARGS[0] if ARGS else 'blockout'
OUT=ROOT/'assets/source'; OUT.mkdir(exist_ok=True,parents=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
scene.unit_settings.system='METRIC'
scene.render.engine='CYCLES'
scene.cycles.device='CPU'
scene.cycles.samples=24
scene.cycles.use_denoising=True
scene.cycles.max_bounces=5
scene.cycles.diffuse_bounces=3
scene.render.threads_mode='FIXED'; scene.render.threads=10
scene.world=bpy.data.worlds.new('Soft daylight')
scene.world.use_nodes=True
bg=next(n for n in scene.world.node_tree.nodes if n.type=='BACKGROUND')
bg.inputs['Color'].default_value=(0.79,0.85,0.92,1)
bg.inputs['Strength'].default_value=.32
scene.view_settings.view_transform='Standard'
scene.view_settings.look='None'
scene.view_settings.exposure=0

def mat(name,color,rough=.8,noise=False,metal=0):
    m=bpy.data.materials.new(name);m.use_nodes=True
    b=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value=(*color,1)
    b.inputs['Roughness'].default_value=rough
    b.inputs['Metallic'].default_value=metal
    if noise:
        tex=m.node_tree.nodes.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=19
        tex.inputs['Detail'].default_value=3
        coordinates=m.node_tree.nodes.new('ShaderNodeTexCoord')
        m.node_tree.links.new(coordinates.outputs['Object'],tex.inputs['Vector'])
        ramp=m.node_tree.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].position=.15;ramp.color_ramp.elements[0].color=tuple(c*.94 for c in color)+(1,)
        ramp.color_ramp.elements[1].position=.85;ramp.color_ramp.elements[1].color=tuple(min(1,c*1.04) for c in color)+(1,)
        m.node_tree.links.new(tex.outputs['Fac'],ramp.inputs[0]);m.node_tree.links.new(ramp.outputs['Color'],b.inputs['Base Color'])
        bump=m.node_tree.nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.1;bump.inputs['Distance'].default_value=.006
        m.node_tree.links.new(tex.outputs['Fac'],bump.inputs['Height']);m.node_tree.links.new(bump.outputs['Normal'],b.inputs['Normal'])
    return m
ivory=mat('Warm mineral plaster',(.74,.73,.67),noise=True)
floor_mat=mat('Honed warm concrete',(.54,.56,.51),.78,True)
canvas_mat=mat('Natural canvas edge',(.79,.76,.67),.92,True)
steel=mat('Graphite powdercoated steel',(.055,.065,.058),.6)
olive=mat('Olive woven upholstery',(.15,.18,.105),.96,True)
stone=mat('Pale travertine',(.66,.63,.51),.8,True)
bronze=mat('Brushed warm metal',(.25,.21,.14),.48,metal=.65)
wood=mat('Oiled European oak',(.39,.28,.16),.64,True)
def fine_plaster(material):
    nodes=material.node_tree.nodes
    base=next(n for n in nodes if n.type=='BSDF_PRINCIPLED').inputs['Base Color'].default_value[:3]
    for n in nodes:
        if n.type=='VALTORGB':
            n.color_ramp.elements[0].color=tuple(c*.985 for c in base)+(1,)
            n.color_ramp.elements[1].color=tuple(c*1.015 for c in base)+(1,)
        elif n.type=='BUMP':n.inputs['Strength'].default_value=.04;n.inputs['Distance'].default_value=.001
fine_plaster(ivory)
ARCH=[];PROPS=[];FLOOR=[];ART=[]
def loc(p):return (p[0],-p[2],p[1])
def cube(name,p,size,material,group=ARCH,bevel=.025,rot=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc(p));o=bpy.context.object;o.name=name
    o.dimensions=(size[0],size[2],size[1]);o.rotation_euler[2]=rot
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.data.materials.append(material)
    if bevel:
        mod=o.modifiers.new('Soft manufactured edges','BEVEL');mod.width=bevel;mod.segments=3
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod=o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL');bpy.ops.object.modifier_apply(modifier=mod.name)
    group.append(o);return o
def cylinder(name,p,radius,depth,material,group=PROPS):
    bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=radius,depth=depth,location=loc(p));o=bpy.context.object;o.name=name;o.data.materials.append(material)
    mod=o.modifiers.new('Rounded rim','BEVEL');mod.width=.035;mod.segments=3;bpy.ops.object.modifier_apply(modifier=mod.name)
    for f in o.data.polygons:f.use_smooth=True
    group.append(o);return o
def sphere(name,p,size,material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=16,location=loc(p));o=bpy.context.object;o.name=name;o.scale=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(material)
    for f in o.data.polygons:f.use_smooth=True
    PROPS.append(o);return o

materials={'canvas':canvas_mat,'steel':steel,'wood':wood,'olive':olive,'stone':stone}
checks=[]
def assembly(asset_id,origin,rot=0,scale=(1,1,1),group=PROPS,label=None):
    asset=next(a for a in SPEC['assets'] if a['id']==asset_id)
    made=[]
    for part in asset['parts']:
        px,py,pz=[part['p'][i]*scale[i] for i in range(3)]
        p=(origin[0]+px*math.cos(rot)+pz*math.sin(rot),origin[1]+py,origin[2]-px*math.sin(rot)+pz*math.cos(rot))
        size=tuple(part['s'][i]*scale[i] for i in range(3))
        o=cube((label or asset_id)+' / '+part['name'],p,size,materials[part['material']],group,part['bevel'],rot)
        o['design_part']=part['name'];o['design_revision']=SPEC['revision'];o['dimensions_m']=size
        # Compare actual local mesh bounds, independently of object rotation.
        bounds=[max(v.co[k] for v in o.data.vertices)-min(v.co[k] for v in o.data.vertices) for k in range(3)]
        err=max(abs(bounds[k]-[size[0],size[2],size[1]][k]) for k in range(3))
        checks.append({'part':o.name,'max_dimension_error_m':err,'pass':err<.001})
        made.append(o)
    return made
W,D,H=[LAYOUT['room'][k] for k in ['width','depth','height']]
A=LAYOUT['architecture'];sill=A['windowSill'];window_top=sill+A['windowHeight']
cube('Grand hall floor',(0,-.12,0),(W,.24,D),floor_mat,FLOOR,.025)
cube('Rear wall',(0,H/2,-D/2-.15),(W,H,.3),ivory)
cube('Right wall',(W/2+.15,H/2,0),(.3,H,D),ivory)
cube('Window sill wall',(-W/2-.15,sill/2,0),(.3,sill,D),ivory)
cube('Window head wall',(-W/2-.15,(H+window_top)/2,0),(.3,H-window_top,D),ivory)
# The raised roof has three real apertures, with deep reveals and a rhythmic beam grid.
for x in [-8,8]:cube('Solid roof wing',(x,H+.12,0),(10,.24,D),ivory)
for z,length in [(-8.75,2.5),(-2.75,1.5),(2.75,1.5),(8.75,2.5)]:
    cube('Roof between skylights',(0,H+.12,z),(6,.24,length),ivory)
for x in [-3.25,3.25]:cube('Skylight longitudinal rib',(x,H-.32,0),(.5,.64,D),ivory)
for z in A['skylights']:
    for x in [-3.0,3.0]:cube('Rooflight side reveal',(x,H+.32,z),(.16,.64,4.16),stone)
    for zz in [z-2,z+2]:cube('Rooflight end reveal',(0,H+.32,zz),(6,.64,.16),stone)
    for x in [-2,-1,0,1,2]:cube('Rooflight glazing bar',(x,H+.66,z),(.035,.08,4),steel,bevel=.004)
for x,z in LAYOUT['columns']:
    cube('Structural column',(x,(H-.6)/2,z),(.8,H-.6,.8),ivory,bevel=.045)
    cube('Column stone foot',(x,.13,z),(1.06,.26,1.06),stone)
    cube('Column capital',(x,H-.76,z),(1.3,.38,1.3),ivory)
for z in A['crossBeams']:cube('Monumental cross beam',(0,H-.38,z),(W,.76,.58),ivory)
for x in [-9.5,9.5]:cube('Aisle longitudinal beam',(x,H-.36,0),(.52,.72,D),ivory)
for z in A['windowCenters']:
    assembly('window',(-W/2,sill,z),math.pi/2,group=ARCH,label='Window '+str(z))
for z in [-9.9,-6.6,-3.3,0,3.3,6.6,9.9]:cube('Window pier',(-W/2,H/2,z),(.46,H,.2),ivory)
# Tall shallow rear bays give the wall scale, depth and a shadow line above the exhibits.
recess=mat('Warm recessed wall',(.66,.65,.58),noise=True)
fine_plaster(recess)
for x in [-7.8,-2.6,2.6,7.8]:
    cube('Recessed exhibition bay',(x,4.4,-D/2+.015),(4.7,8.0,.025),recess,bevel=.012)
for x in [-10.4,-5.2,0,5.2,10.4]:cube('Rear wall pilaster',(x,4.45,-D/2+.15),(.4,8.9,.3),ivory)
cube('Rear wall entablature',(0,8.82,-D/2+.22),(W,.32,.44),ivory)
for z in [-7,0,7]:cube('Right wall pilaster',(W/2-.13,4.45,z),(.26,8.9,.42),ivory)
cube('Right wall cornice',(W/2-.16,8.82,0),(.32,.32,D),ivory)
# Pale exterior has no shadow contribution, letting real window apertures shape sunlight.
sky=mat('Exterior daylight',(.78,.83,.82),1)
b=next(n for n in sky.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
b.inputs['Emission Color'].default_value=(.78,.83,.82,1);b.inputs['Emission Strength'].default_value=.55
ext=cube('Exterior wash',(-W/2-2,6,0),(.1,15,D+10),sky,ARCH,0);ext.visible_shadow=False
for z in A['skylights']:
    sky_panel=cube('Rooflight sky',(0,H+1,z),(6.1,.04,4.1),sky,ARCH,0);sky_panel.visible_shadow=False
# Subtle floor joints are real grooves/lines, not oversized dark grids.
joint=mat('Concrete expansion joint',(.35,.36,.32),1)
for x in [-12,-8,-4,0,4,8,12]:cube('Floor joint',(x,.001,0),(.007,.002,D),joint,ARCH,0)
for z in [-8,-4,0,4,8]:cube('Floor joint',(0,.001,z),(W,.002,.007),joint,ARCH,0)
for x in [-8.9,8.9]:cube('Aisle stone inlay',(x,.002,0),(.06,.004,D),stone,ARCH,0)
for i,a in enumerate(LAYOUT['artworks']):
    x,y,z=a['position'];rot=a['rotation'];w=a['width'];h=a['height']
    # The four side canvases scale the canvas-only members; feet retain physical dimensions.
    parts=assembly('canvas',(x,0,z),rot,label='Canvas '+a['id'])
    if h!=3.1:
        for o in parts:
            if 'upright' in o.name or 'foot' in o.name or 'fixing' in o.name:continue
            # Transform in assembly-local frame so rear braces and skin share the same proportions.
            rel=o.location-Vector(loc((x,0,z)))
            localx=rel.x*math.cos(rot)+rel.y*math.sin(rot)
            localz=-rel.x*math.sin(rot)+rel.y*math.cos(rot)
            localx*=w/2.35
            o.location.x=x+localx*math.cos(rot)-localz*math.sin(rot)
            o.location.y=-z+localx*math.sin(rot)+localz*math.cos(rot)
            o.location.z=.35+(o.location.z-.35)*h/3.1
            o.scale.x*=w/2.35;o.scale.z*=h/3.1
            bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    # Rectangular artwork uses its own UVs and images, independent from baked building.
    m=bpy.data.materials.new('Artwork '+a['id']);m.use_nodes=True
    nodes=m.node_tree.nodes;nodes.clear();out=nodes.new('ShaderNodeOutputMaterial');em=nodes.new('ShaderNodeEmission');tex=nodes.new('ShaderNodeTexImage')
    # Blender cannot decode WebP: the postprocessing script supplies PNG sources first.
    tex.image=bpy.data.images.load(str(ROOT/'assets/source'/f"{a['id']}.png"));m.node_tree.links.new(tex.outputs['Color'],em.inputs[0]);m.node_tree.links.new(em.outputs[0],out.inputs['Surface'])
    bpy.ops.mesh.primitive_plane_add(size=1,location=loc((x+math.sin(rot)*.030,y,z+math.cos(rot)*.030)))
    o=bpy.context.object;o.name='ArtworkSurface_'+a['id'];o.rotation_euler=(math.pi/2,0,rot);o.scale=(w-.035,h-.035,1);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m);ART.append(o)
# Seating and small objects sit behind the camera transition corridors.
prop_positions={p['type']:p['position'] for p in LAYOUT['props']}
assembly('bench',prop_positions['bench'])
assembly('chair',prop_positions['chair'],-.25)
assembly('plinth',prop_positions['plinth'])
plinth_x,_,plinth_z=prop_positions['plinth']
# Revolved ceramic profile includes the inner wall and a closed base.
profile=[(0,0),(.13,0),(.16,.025),(.19,.18),(.18,.35),(.145,.46),(.127,.46),(.162,.35),(.172,.18),(.142,.04),(0,.04)]
verts=[];faces=[];N=64
for r,h in profile:
    for k in range(N):verts.append((plinth_x+r*math.cos(k*2*math.pi/N),-plinth_z+r*math.sin(k*2*math.pi/N),.85+h))
for j in range(len(profile)-1):
    for k in range(N):faces.append((j*N+k,j*N+(k+1)%N,(j+1)*N+(k+1)%N,(j+1)*N+k))
mesh=bpy.data.meshes.new('Vessel revolved hollow profile');mesh.from_pydata(verts,[],faces);mesh.update()
vessel=bpy.data.objects.new('Hollow ceramic vessel 18mm wall',mesh);scene.collection.objects.link(vessel);vessel.data.materials.append(canvas_mat)
for f in mesh.polygons:f.use_smooth=True
PROPS.append(vessel)
sphere('Small sculptural stone',(plinth_x+.29,.98,plinth_z-.03),(.13,.13,.13),bronze)
# Neutral project-free back-wall sign; lettering is geometry.
fontcurve=bpy.data.curves.new('Gallery wordmark','FONT');fontcurve.body='S T I L L';fontcurve.align_x='CENTER';fontcurve.size=.44;fontcurve.extrude=.002
obj=bpy.data.objects.new('Wall wordmark',fontcurve);scene.collection.objects.link(obj);obj.location=loc((0,9.32,-D/2+.025));obj.rotation_euler=(math.pi/2,0,0);obj.data.materials.append(steel)
bpy.context.view_layer.objects.active=obj;obj.select_set(True);bpy.ops.object.convert(target='MESH');ARCH.append(bpy.context.object);obj.select_set(False)

def light(name,kind,p,energy,color,size=5,target=(0,0,0)):
    d=bpy.data.lights.new(name,kind);o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=loc(p);d.energy=energy;d.color=color
    if kind=='AREA':d.shape='DISK';d.size=size
    o.rotation_euler=(Vector(loc(target))-o.location).to_track_quat('-Z','Y').to_euler();return o
sun=light('Afternoon sunlight','SUN',(-14,16,5),.85,(1,.94,.84),target=(0,0,-4));sun.data.angle=.12
light('Window fill','AREA',(-12.8,5.5,0),1800,(.88,.94,1),17,(0,2,0))
for z in A['skylights']:light('Rooflight daylight','AREA',(0,H-.1,z),350,(1,.98,.93),4,(0,0,z))
light('Entry bounce','AREA',(0,6,9.5),600,(1,.96,.88),12,(0,3,-5))
cam_data=bpy.data.cameras.new('Entry camera');cam=bpy.data.objects.new('Entry camera',cam_data);scene.collection.objects.link(cam);scene.camera=cam
def setcamera(p,target):cam.location=loc(p);cam.rotation_euler=(Vector(loc(target))-cam.location).to_track_quat('-Z','Y').to_euler()
setcamera(LAYOUT['overview']['position'],LAYOUT['overview']['target']);cam_data.sensor_fit='VERTICAL';cam_data.lens=cam_data.sensor_height/(2*math.tan(math.radians(58)/2))
scene.render.resolution_x=1440;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'

def join_unwrap(objects,name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();o=bpy.context.object;o.name=name
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.018);bpy.ops.object.mode_set(mode='OBJECT')
    return o

(ROOT/'docs/dimension-checks.json').write_text(json.dumps(checks,indent=2))
assert all(c['pass'] for c in checks),'Model dimensions differ from design specification'
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'gallery-editable.blend'))
if STAGE in ['blockout','review']:
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'gallery-blockout.blend'))
    scene.cycles.samples=12;scene.render.resolution_percentage=65
    scene.render.filepath=str(ROOT/'assets/design/blockout-overview.png');bpy.ops.render.render(write_still=True)
    if STAGE=='review':
        # Close inspection of real assembly geometry, with all surrounding objects hidden.
        ax,ay,az=LAYOUT['artworks'][0]['position'];cx,_,cz=prop_positions['chair']
        for target,p,targetp in [('Canvas sol',(ax+2.1,2.5,az-2),(ax,1.7,az)),('chair',(cx+.95,.95,cz+1.15),(cx,.4,cz))]:
            hidden=[]
            for o in scene.objects:
                if o.type=='MESH' and not o.name.startswith(target) and o not in FLOOR:
                    hidden.append(o);o.hide_render=True
            setcamera(p,targetp);cam_data.lens=40
            scene.render.filepath=str(ROOT/'assets/design/model-sheets'/('verified-'+target.replace(' ','-')+'.png'));bpy.ops.render.render(write_still=True)
            for o in hidden:o.hide_render=False
    print('REVIEW_COMPLETE',flush=True)
else:
    objects=[join_unwrap(FLOOR,'Baked_Floor'),join_unwrap(ARCH,'Baked_Architecture'),join_unwrap(PROPS,'Baked_Props')]
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'gallery-materials.blend'))
    if STAGE=='prepare':
        print('UV_SOURCE_READY',flush=True)
        sys.exit(0)
    for o in ART:o.hide_render=True
    # Low-resolution bake before the final textures, preserved for inspection.
    baked=[]
    for idx,o in enumerate(objects):
        bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
        slots=[m for m in o.data.materials if m]
        for passname,size,samples in [('test',256,4),('final',2048 if idx<2 else 1024,20)]:
            print('BAKE_START',o.name,passname,size,flush=True)
            im=bpy.data.images.new(o.name+'_'+passname,width=size,height=size,alpha=False)
            for m in slots:
                n=m.node_tree.nodes.new('ShaderNodeTexImage');n.image=im;m.node_tree.nodes.active=n
            scene.cycles.samples=samples;scene.render.bake.margin=16
            bpy.ops.object.bake(type='DIFFUSE',pass_filter={'COLOR','DIRECT','INDIRECT'},use_clear=True)
            im.filepath_raw=str(OUT/(o.name+'_'+passname+'.png'));im.file_format='PNG';im.save()
            print('BAKE_COMPLETE',o.name,passname,flush=True)
        baked.append((o,im))
    # Switch to baked materials only after every bake, preserving the same source lighting.
    for o,im in baked:
        m=bpy.data.materials.new(o.name+'_LightBaked');m.use_nodes=True;n=m.node_tree.nodes;n.clear()
        out=n.new('ShaderNodeOutputMaterial');em=n.new('ShaderNodeEmission');tex=n.new('ShaderNodeTexImage');tex.image=im
        m.node_tree.links.new(tex.outputs['Color'],em.inputs[0]);m.node_tree.links.new(em.outputs[0],out.inputs['Surface'])
        o.data.materials.clear();o.data.materials.append(m)
        for poly in o.data.polygons:poly.material_index=0
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.export_layout(filepath=str(OUT/(o.name+'-uv.svg')),mode='SVG',size=(2048,2048),opacity=.2);bpy.ops.object.mode_set(mode='OBJECT')
    # GLB stores geometry, UVs and materials; web versions load compressed atlases separately.
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/gallery.glb'),export_format='GLB',use_selection=True,export_materials='NONE',export_cameras=False,export_lights=False)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'gallery.blend'))
    scene.cycles.samples=16;scene.render.filepath=str(ROOT/'public/gallery-poster.png');bpy.ops.render.render(write_still=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'gallery.blend'))
    report={'room':LAYOUT['room'],'bake_sizes':[2048,2048,1024],'objects':[{ 'name':o.name,'vertices':len(o.data.vertices),'polygons':len(o.data.polygons),'uv_layers':len(o.data.uv_layers)} for o in objects]}
    (ROOT/'docs/model-report.json').write_text(json.dumps(report,indent=2))
    print('GALLERY_COMPLETE',flush=True)
