type Layout=typeof import('./data/layout.json').default;
export function isWalkable(layout:Layout,p:number[],margin?:number):boolean;
export function clearSegment(layout:Layout,a:number[],b:number[],margin?:number):boolean;
export function cameraPose(layout:Layout,id:string|null,mobile:boolean,aspect:number):{position:number[];target:number[];fov:number;room:string};
export function planRoute(layout:Layout,from:number[],to:number[]):number[][];
export function routeMetrics(points:number[][]):{distances:number[];total:number};
export function sampleRoute(points:number[][],metrics:{distances:number[];total:number},t:number):number[];
