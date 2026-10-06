"""Refine the large plaster surfaces without changing the approved geometry or UVs."""
import bpy
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
for filename in ['gallery-editable.blend','gallery-materials.blend']:
    path=ROOT/'assets/source'/filename;bpy.ops.wm.open_mainfile(filepath=str(path))
    for name in ['Warm mineral plaster','Warm recessed wall']:
        nodes=bpy.data.materials[name].node_tree.nodes
        base=next(n for n in nodes if n.type=='BSDF_PRINCIPLED').inputs['Base Color'].default_value[:3]
        for n in nodes:
            if n.type=='VALTORGB':
                n.color_ramp.elements[0].color=tuple(c*.985 for c in base)+(1,)
                n.color_ramp.elements[1].color=tuple(c*1.015 for c in base)+(1,)
            elif n.type=='BUMP':n.inputs['Strength'].default_value=.04;n.inputs['Distance'].default_value=.001
    bpy.ops.wm.save_as_mainfile(filepath=str(path))
