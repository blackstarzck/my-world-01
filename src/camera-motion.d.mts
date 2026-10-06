type Key={position:number[];distance:number;yaw:number;pitch:number;fov:number;time:number;turn:boolean};
type Slope={distance:number;yaw:number;pitch:number;fov:number};
export type CameraMotion={keys:Key[];slopes:Slope[];points:number[][];metrics:{distances:number[];total:number};duration:number};
export function createCameraMotion(points:number[][],fromTarget:number[],toTarget:number[],fromFov:number,toFov:number,returning?:boolean):CameraMotion;
export function sampleCameraMotion(motion:CameraMotion,seconds:number):{position:number[];yaw:number;pitch:number;fov:number;done:boolean};
