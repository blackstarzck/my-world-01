"""Remove Cycles sampling noise from baked lightmaps with Blender's bundled OIDN.
Original samples are retained as *_final.png; filtered output is *_clean.png.
"""
import ctypes as c, os, sys, json
from pathlib import Path
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
MUSEUM='--museum' in sys.argv
LAYOUT=json.loads((ROOT/'src/data/layout.json').read_text())
SOURCE=ROOT/LAYOUT['sourceDirectory'] if MUSEUM else ROOT/'assets/source'
NAMES=LAYOUT['textureGroups'] if MUSEUM else ['Baked_Floor','Baked_Architecture','Baked_Props']
if '--available' in sys.argv:NAMES=[n for n in NAMES if (SOURCE/f'{n}_final.png').exists()]
if '--missing' in sys.argv:NAMES=[n for n in NAMES if not (SOURCE/f'{n}_clean.png').exists()]
if '--fresh' in sys.argv:NAMES=[n for n in NAMES if not (SOURCE/f'{n}_clean.png').exists() or (SOURCE/f'{n}_final.png').stat().st_mtime>(SOURCE/f'{n}_clean.png').stat().st_mtime]
libdir=Path(os.environ.get('BLENDER_SHARED',r'C:\Program Files\Blender Foundation\Blender 5.1\blender.shared'))
with os.add_dll_directory(str(libdir)):
    os.environ['PATH']=str(libdir)+os.pathsep+os.environ.get('PATH','')
    os.environ['OIDN_VERBOSE']='2'
    os.chdir(libdir)
    cpu_module=c.CDLL(str(libdir/'OpenImageDenoise_device_cpu.dll'))
    oidn=c.CDLL(str(libdir/'OpenImageDenoise.dll'))
    def bind(name,restype,args):
        f=getattr(oidn,name);f.restype=restype;f.argtypes=args;return f
    ptr=c.c_void_p;sz=c.c_size_t;string=c.c_char_p
    new=bind('oidnNewDevice',ptr,[c.c_int]);commit=bind('oidnCommitDevice',None,[ptr])
    setint=bind('oidnSetDeviceInt',None,[ptr,string,c.c_int])
    newfilter=bind('oidnNewFilter',ptr,[ptr,string])
    image=bind('oidnSetSharedFilterImage',None,[ptr,string,ptr,c.c_int,sz,sz,sz,sz,sz])
    boolean=bind('oidnSetFilterBool',None,[ptr,string,c.c_bool])
    commitfilter=bind('oidnCommitFilter',None,[ptr]);execute=bind('oidnExecuteFilter',None,[ptr])
    error=bind('oidnGetDeviceError',c.c_int,[ptr,c.POINTER(string)])
    releasefilter=bind('oidnReleaseFilter',None,[ptr]);release=bind('oidnReleaseDevice',None,[ptr])
    device=new(1);setint(device,b'numThreads',8);commit(device)
    for name in NAMES:
        src=SOURCE/f'{name}_final.png'
        data=np.ascontiguousarray(np.array(Image.open(src).convert('RGB'),dtype=np.float32)/255)
        result=np.empty_like(data);h,w,_=data.shape;f=newfilter(device,b'RT')
        image(f,b'color',data.ctypes.data,3,w,h,0,0,0);image(f,b'output',result.ctypes.data,3,w,h,0,0,0)
        boolean(f,b'hdr',False);boolean(f,b'srgb',True);commitfilter(f);execute(f)
        message=string();code=error(device,c.byref(message))
        if code:raise RuntimeError(message.value)
        Image.fromarray(np.uint8(np.clip(result,0,1)*255)).save(SOURCE/f'{name}_clean.png')
        releasefilter(f);print('DENOISED',name,flush=True)
    release(device)
