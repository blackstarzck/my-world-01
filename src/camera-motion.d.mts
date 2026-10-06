type Key={position:number[];yaw:number;pitch:number;fov:number;time:number;turn:boolean};
export type CameraMotion={keys:Key[];duration:number};
export function createCameraMotion(points:number[][],fromTarget:number[],toTarget:number[],fromFov:number,toFov:number,returning?:boolean):CameraMotion;
export function sampleCameraMotion(motion:CameraMotion,seconds:number):{position:number[];yaw:number;pitch:number;fov:number;done:boolean};
