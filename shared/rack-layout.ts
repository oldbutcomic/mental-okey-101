import { COLORS, effectiveTile, findRackMeldGroups, findRackPairGroups, type GameState, type RackGeometry, type RackPoint, type Tile } from './game';

export type PositionedRackTile={tileId:number;position:RackPoint};
export type RackDropZoneBounds={left:number;top:number;right:number;bottom:number};

export function pointIsInsideDropZone(point:{x:number;y:number},bounds:RackDropZoneBounds|null):boolean {
  return !!bounds&&point.x>=bounds.left&&point.x<=bounds.right&&point.y>=bounds.top&&point.y<=bounds.bottom;
}

export function getRackDragTileIds(tileId:number,groupTileIds:number[],detachFromGroup=false):number[] {
  return !detachFromGroup&&groupTileIds.includes(tileId)?[...groupTileIds]:[tileId];
}

const EDGE_PADDING=8;
// rack-deck has 5px vertical padding; EDGE_PADDING is horizontal-only.
const RAIL_PADDING=5;
const DROP_SLOT_GAP=2;
const MELD_GROUP_GAP=15;

function railCenterY(rail:'upper'|'lower',geometry:RackGeometry):number {
  const height=Math.max(1,geometry.height),halfTile=geometry.tileHeight/2;
  const divider=height/2;
  const min=rail==='upper'?RAIL_PADDING+halfTile:divider+halfTile;
  const max=rail==='upper'?divider-halfTile:height-RAIL_PADDING-halfTile;
  return min<=max?(min+max)/2:(rail==='upper'?height*.27:height*.73);
}

function xBounds(geometry:RackGeometry):{min:number;max:number} {
  const width=Math.max(1,geometry.width),halfTile=geometry.tileWidth/2;
  const min=halfTile+EDGE_PADDING,max=width-halfTile-EDGE_PADDING;
  return min<=max?{min,max}:{min:width/2,max:width/2};
}

export type RackAutoSortMode='series'|'pairs';

export type RackAutoSortCandidate={tileIds:number[];score:number};

/** Selects disjoint meld candidates by score, coverage, then fewer groups. */
export function selectRackAutoSortGroups(tileIds:number[],options:readonly RackAutoSortCandidate[],tileScores?:ReadonlyMap<number,number>):number[][] {
  if(tileIds.length>30)throw new Error('Istaka otomatik dizimi en fazla 30 taşı destekler');
  type Candidate=RackAutoSortCandidate&{mask:number;firstIndex:number};
  const indexById=new Map(tileIds.map((id,index)=>[id,index])),candidateByKey=new Map<string,Candidate>();
  for(const option of options){
    const indexes=option.tileIds.map(id=>indexById.get(id));
    if(!option.tileIds.length||new Set(option.tileIds).size!==option.tileIds.length||indexes.some(index=>index===undefined))continue;
    const validIndexes=indexes as number[],key=[...option.tileIds].sort((a,b)=>a-b).join(','),score=Number.isFinite(option.score)?option.score:0;
    const candidate={tileIds:[...option.tileIds],score,mask:validIndexes.reduce((value,index)=>value|(1<<index),0),firstIndex:Math.min(...validIndexes)};
    const previous=candidateByKey.get(key);
    if(!previous||candidate.score>previous.score)candidateByKey.set(key,candidate);
  }
  const candidates=[...candidateByKey.values()].sort((a,b)=>b.score-a.score||b.tileIds.length-a.tileIds.length||a.firstIndex-b.firstIndex||a.tileIds.join(',').localeCompare(b.tileIds.join(',')));
  const candidatesByIndex=tileIds.map((_,index)=>candidates.filter(candidate=>(candidate.mask&(1<<index))!==0));
  type Solution={score:number;covered:number;groups:Candidate[]};
  const memo=new Map<number,Solution>();
  const better=(candidate:Solution,best:Solution)=>candidate.score>best.score||(candidate.score===best.score&&(candidate.covered>best.covered||(candidate.covered===best.covered&&candidate.groups.length<best.groups.length)));
  const countBits=(value:number)=>{let count=0;while(value){value&=value-1;count++;}return count};
  const solve=(available:number):Solution=>{
    if(available===0)return{score:0,covered:0,groups:[]};
    const cached=memo.get(available);if(cached)return cached;
    const availableCount=countBits(available),lowestBit=available&-available,index=31-Math.clz32(lowestBit);
    let scoreUpperBound=0;
    if(tileScores)for(let i=0;i<tileIds.length;i++)if(available&(1<<i))scoreUpperBound+=tileScores.get(tileIds[i])??0;
    let best=solve(available^lowestBit);
    for(const candidate of candidatesByIndex[index]){
      if((candidate.mask&available)!==candidate.mask)continue;
      const rest=solve(available^candidate.mask),proposed={score:candidate.score+rest.score,covered:candidate.tileIds.length+rest.covered,groups:[candidate,...rest.groups]};
      if(better(proposed,best))best=proposed;
      // Stop only after the whole hand reaches its score bound, maximum coverage,
      // and the theoretical minimum group count (unlike the old coverage-only exit).
      if(tileScores&&best.covered===availableCount&&best.score===scoreUpperBound&&best.groups.length===Math.ceil(availableCount/13))break;
    }
    memo.set(available,best);return best;
  };
  return solve((1<<tileIds.length)-1).groups.sort((a,b)=>a.firstIndex-b.firstIndex).map(group=>group.tileIds);
}

/** Find the highest-scoring non-overlapping set of valid groups for series sorting. */
export function findRackAutoSortGroups(tiles:Tile[],joker:GameState['joker'],mode:RackAutoSortMode):number[][] {
  if(mode==='pairs')return findRackPairGroups(tiles,joker);

  const indexById=new Map(tiles.map((tile,index)=>[tile.id,index])),candidateByKey=new Map<string,RackAutoSortCandidate&{firstIndex:number}>();
  const effective=tiles.map(tile=>effectiveTile(tile,joker));
  const tileScores=new Map(tiles.map((tile,index)=>[tile.id,effective[index].number??0]));
  const selectedTiles:Tile[]=[];
  const addCandidate=()=>{
    const detected=findRackMeldGroups(selectedTiles,joker);
    if(detected.length!==1||detected[0].length!==selectedTiles.length)return;
    const tileIds=[...detected[0]],indexes=tileIds.map(id=>indexById.get(id));
    if(indexes.some(index=>index===undefined))return;
    const validIndexes=indexes as number[];
    const key=[...tileIds].sort((a,b)=>a-b).join(','),score=validIndexes.reduce((sum,index)=>sum+(effective[index].number??0),0);
    if(!candidateByKey.has(key))candidateByKey.set(key,{tileIds,score,firstIndex:Math.min(...validIndexes)});
  };

  const enumerateSlots=(slots:{color:typeof COLORS[number];number:number}[])=>{
    const usedIndexes=new Set<number>();
    const choose=(offset:number)=>{
      if(offset===slots.length){addCandidate();return}
      const slot=slots[offset];
      const choices=tiles.map((tile,index)=>({tile,index,face:effective[index]})).filter(entry=>
        !usedIndexes.has(entry.index)&&(entry.face.wild||(entry.face.color===slot.color&&entry.face.number===slot.number)),
      ).sort((a,b)=>Number(a.face.wild)-Number(b.face.wild)||a.index-b.index);
      for(const entry of choices){
        usedIndexes.add(entry.index);selectedTiles.push(entry.tile);
        choose(offset+1);
        selectedTiles.pop();usedIndexes.delete(entry.index);
      }
    };
    choose(0);
  };

  for(const color of COLORS){
    for(let start=1;start<=13;start++){
      for(let length=3;length<=13&&start+length-1<=13;length++){
        enumerateSlots(Array.from({length},(_,offset)=>({color,number:start+offset})));
      }
    }
  }
  for(let number=1;number<=13;number++)for(const size of [3,4]){
    const chooseColors=(start:number,selected:typeof COLORS)=>{
      if(selected.length===size){enumerateSlots(selected.map(color=>({color,number})));return}
      for(let index=start;index<COLORS.length;index++)chooseColors(index+1,[...selected,COLORS[index]]);
    };
    chooseColors(0,[]);
  }

  const options=[...candidateByKey.values()];
  return selectRackAutoSortGroups(tiles.map(tile=>tile.id),options,tileScores);
}

/** Lay selected melds as tight groups and keep all unmatched tiles as ordinary rack tiles. */
export function layoutRackAutoSort(
  tiles:Tile[],groups:number[][],geometry:RackGeometry,
):Record<number,RackPoint>|null {
  const width=Math.max(1,geometry.width),height=Math.max(1,geometry.height),tileWidth=Math.max(1,geometry.tileWidth),{min,max}=xBounds(geometry),span=max-min;
  type Unit={kind:'group'|'loose';tileIds:number[]};
  const handIds=new Set(tiles.map(tile=>tile.id)),used=new Set<number>();
  const groupUnits:Unit[]=[];
  for(const tileIds of groups){
    if(tileIds.length<2||tileIds.some(id=>!handIds.has(id)||used.has(id)))return null;
    tileIds.forEach(id=>used.add(id));groupUnits.push({kind:'group',tileIds:[...tileIds]});
  }
  const looseIds=tiles.filter(tile=>!used.has(tile.id)).map(tile=>tile.id);
  const rows:Unit[][]=[[],[]],rowWidths=[0,0];
  for(const unit of groupUnits){
    const unitWidth=unit.tileIds.length*tileWidth;
    if(unitWidth>span)return null;
    const fits=[0,1].map(rowIndex=>({rowIndex,gap:rows[rowIndex].length?MELD_GROUP_GAP:0})).filter(candidate=>rowWidths[candidate.rowIndex]+candidate.gap+unitWidth<=span+.01).sort((a,b)=>(span-rowWidths[a.rowIndex]-a.gap-unitWidth)-(span-rowWidths[b.rowIndex]-b.gap-unitWidth)||a.rowIndex-b.rowIndex);
    const target=fits[0];
    if(!target)return null;
    rows[target.rowIndex].push(unit);rowWidths[target.rowIndex]+=target.gap+unitWidth;
  }
  let looseOffset=0;
  for(let rowIndex=0;rowIndex<2&&looseOffset<looseIds.length;rowIndex++){
    const gap=rows[rowIndex].length?MELD_GROUP_GAP:0;
    const capacity=Math.max(0,Math.floor((span-rowWidths[rowIndex]-gap+.01)/tileWidth));
    const count=Math.min(capacity,looseIds.length-looseOffset);
    if(count){rows[rowIndex].push({kind:'loose',tileIds:looseIds.slice(looseOffset,looseOffset+count)});rowWidths[rowIndex]+=gap+count*tileWidth;looseOffset+=count;}
  }
  if(looseOffset<looseIds.length)return null;

  const positions:Record<number,RackPoint>={};
  for(let rowIndex=0;rowIndex<2;rowIndex++){
    const row=rows[rowIndex],totalWidth=rowWidths[rowIndex];
    let cursor=min+Math.max(0,(span-totalWidth)/2);
    const y=(rowIndex===0?railCenterY('upper',geometry):railCenterY('lower',geometry))/height;
    row.forEach((unit,unitIndex)=>{
      if(unitIndex)cursor+=MELD_GROUP_GAP;
      for(const tileId of unit.tileIds){positions[tileId]={x:(cursor+tileWidth/2)/width,y};cursor+=tileWidth;}
    });
  }
  return positions;
}

/** Place a newly dealt hand in two centered rows using the same tight stop spacing as rack drops. */
export function initialRackPosition(index:number,total:number,geometry:RackGeometry):RackPoint {
  const handSize=Math.max(1,total),upperCount=Math.ceil(handSize/2),isUpper=index<upperCount;
  const rowIndex=isUpper?index:index-upperCount,rowCount=isUpper?upperCount:Math.max(1,handSize-upperCount);
  const {min,max}=xBounds(geometry),tileWidth=Math.max(1,geometry.tileWidth),availableSpan=Math.max(0,max-min);
  const desiredStep=tileWidth+DROP_SLOT_GAP;
  const step=rowCount>1?Math.min(desiredStep,availableSpan/(rowCount-1)):desiredStep;
  const rowSpan=(rowCount-1)*step;
  const start=min+Math.max(0,(availableSpan-rowSpan)/2);
  const x=start+rowIndex*step;
  const rail=isUpper?'upper':'lower';
  return{x:x/Math.max(1,geometry.width),y:railCenterY(rail,geometry)/Math.max(1,geometry.height)};
}

/** Drop coordinates for tiles that left the hand so a later reclaimed tile cannot reuse stale state. */
export function retainRackPositionsForHand(positions:Record<number,RackPoint>,tileIds:number[]):Record<number,RackPoint> {
  const activeIds=new Set(tileIds);
  return Object.fromEntries(Object.entries(positions).filter(([tileId])=>activeIds.has(Number(tileId)))) as Record<number,RackPoint>;
}

function xCenters(geometry:RackGeometry,step:number,tilesInBlock=1):number[] {
  const {min,max}=xBounds(geometry),halfTile=geometry.tileWidth/2;
  const last=max-(tilesInBlock-1)*step;
  if(last<min)return [];
  const result:number[]=[];
  for(let x=min;x<=last+.01;x+=step)result.push(x);
  return result;
}

/** Clamp a dragged tile to the closest physical rail and keep its full face inside the rack. */
export function constrainRackPosition(position:RackPoint,geometry:RackGeometry):RackPoint {
  const width=Math.max(1,geometry.width),height=Math.max(1,geometry.height);
  const {min,max}=xBounds(geometry),centerX=Math.max(min,Math.min(max,position.x*width));
  const rail=position.y*height<height/2?'upper':'lower';
  return{x:centerX/width,y:railCenterY(rail,geometry)/height};
}

function overlaps(a:RackPoint,b:RackPoint,geometry:RackGeometry):boolean {
  return Math.abs((a.x-b.x)*geometry.width)<geometry.tileWidth-.5&&
    Math.abs((a.y-b.y)*geometry.height)<geometry.tileHeight-.5;
}

export function rackPositionIsAvailable(
  position:RackPoint,
  occupied:PositionedRackTile[],
  geometry:RackGeometry,
  movingTileId?:number,
):boolean {
  const width=Math.max(1,geometry.width),height=Math.max(1,geometry.height),x=position.x*width,y=position.y*height;
  const {min,max}=xBounds(geometry),halfHeight=geometry.tileHeight/2,divider=height/2;
  const upper=y<divider;
  const minY=upper?RAIL_PADDING+halfHeight:divider+halfHeight;
  const maxY=upper?divider-halfHeight:height-RAIL_PADDING-halfHeight;
  if(x<min-.5||x>max+.5||y<minY-.5||y>maxY+.5)return false;
  return !occupied.some(tile=>tile.tileId!==movingTileId&&overlaps(position,tile.position,geometry));
}

/** Find the nearest empty tile-sized stop, checking both rails and ignoring the moving tile. */
export function resolveRackDropPosition(
  requested:RackPoint,
  occupied:PositionedRackTile[],
  geometry:RackGeometry,
  movingTileId?:number,
):RackPoint|null {
  const target=constrainRackPosition(requested,geometry);
  const width=Math.max(1,geometry.width),height=Math.max(1,geometry.height);
  const candidates:(RackPoint&{distance:number})[]=[];
  const {min,max}=xBounds(geometry);
  const xs=new Set<number>([...xCenters(geometry,geometry.tileWidth+DROP_SLOT_GAP),target.x*width]);
  for(const rail of ['upper','lower'] as const){
    const y=railCenterY(rail,geometry)/height;
    for(const tile of occupied){
      const tileY=tile.position.y*height;
      if(Math.abs(tileY-y*height)<geometry.tileHeight){
        const tileX=tile.position.x*width;
        for(const offset of [geometry.tileWidth,geometry.tileWidth+DROP_SLOT_GAP]){
          xs.add(Math.max(min,Math.min(max,tileX-offset)));
          xs.add(Math.max(min,Math.min(max,tileX+offset)));
        }
      }
    }
    for(const x of xs){
      const point={x:x/width,y};
      if(!rackPositionIsAvailable(point,occupied,geometry,movingTileId))continue;
      const dx=(point.x-target.x)*width,dy=(point.y-target.y)*height;
      candidates.push({...point,distance:dx*dx+dy*dy});
    }
  }
  candidates.sort((a,b)=>a.distance-b.distance);
  return candidates[0]?{x:candidates[0].x,y:candidates[0].y}:null;
}

/** Pick a random unoccupied tile-sized stop from either rack rail. */
export function randomAvailableRackPosition(
  occupied:PositionedRackTile[],
  geometry:RackGeometry,
  random=Math.random,
):RackPoint|null {
  const width=Math.max(1,geometry.width),height=Math.max(1,geometry.height),xs=xCenters(geometry,geometry.tileWidth+DROP_SLOT_GAP);
  const candidates:RackPoint[]=[];
  for(const rail of ['upper','lower'] as const){
    const y=railCenterY(rail,geometry)/height;
    for(const x of xs){
      const point={x:x/width,y};
      if(rackPositionIsAvailable(point,occupied,geometry))candidates.push(point);
    }
  }
  if(!candidates.length)return null;
  const value=random(),index=Number.isFinite(value)?Math.min(candidates.length-1,Math.max(0,Math.floor(value*candidates.length))):0;
  return candidates[index];
}

/** Move a detected meld as one rigid block. Its own members are deliberately excluded from blockers. */
export function resolveRackGroupDropPositions(
  tileIds:number[],
  positions:Record<number,RackPoint>,
  anchorTileId:number,
  requestedAnchor:RackPoint,
  occupied:PositionedRackTile[],
  geometry:RackGeometry,
):Record<number,RackPoint>|null {
  if(tileIds.length<2||!tileIds.includes(anchorTileId)||tileIds.some(id=>!positions[id]))return null;
  const width=Math.max(1,geometry.width),height=Math.max(1,geometry.height),anchorStart=positions[anchorTileId];
  const groupIds=new Set(tileIds),blockers=occupied.filter(tile=>!groupIds.has(tile.tileId));
  const target=constrainRackPosition(requestedAnchor,geometry),targetRail=target.y<.5?'upper':'lower';
  const offsets=tileIds.map(id=>({id,x:(positions[id].x-anchorStart.x)*width,y:(positions[id].y-anchorStart.y)*height}));
  const minOffset=Math.min(...offsets.map(offset=>offset.x)),maxOffset=Math.max(...offsets.map(offset=>offset.x));
  const bounds=xBounds(geometry),minAnchorX=bounds.min-minOffset,maxAnchorX=bounds.max-maxOffset;
  if(minAnchorX>maxAnchorX)return null;
  const clampAnchorX=(x:number)=>Math.max(minAnchorX,Math.min(maxAnchorX,x));
  const candidateXs=new Set<number>([clampAnchorX(target.x*width),minAnchorX,maxAnchorX]);
  for(let x=minAnchorX;x<=maxAnchorX+.01;x+=geometry.tileWidth+DROP_SLOT_GAP)candidateXs.add(x);
  for(const other of blockers){
    const otherX=other.position.x*width;
    for(const offset of offsets){
      for(const clearance of [geometry.tileWidth,geometry.tileWidth+DROP_SLOT_GAP]){
        candidateXs.add(clampAnchorX(otherX-clearance-offset.x));
        candidateXs.add(clampAnchorX(otherX+clearance-offset.x));
      }
    }
  }
  const rails=[targetRail,targetRail==='upper'?'lower':'upper'] as const;
  const candidates:{positions:Record<number,RackPoint>;distance:number}[]=[];
  for(const rail of rails){
    const anchorY=railCenterY(rail,geometry),deltaY=anchorY-anchorStart.y*height;
    for(const anchorX of candidateXs){
      const deltaX=anchorX-anchorStart.x*width;
      const candidate=Object.fromEntries(offsets.map(offset=>[offset.id,{x:(positions[offset.id].x*width+deltaX)/width,y:(positions[offset.id].y*height+deltaY)/height}])) as Record<number,RackPoint>;
      if(offsets.some(offset=>!rackPositionIsAvailable(candidate[offset.id],blockers,geometry,offset.id)))continue;
      const dx=anchorX-target.x*width,dy=anchorY-target.y*height;
      candidates.push({positions:candidate,distance:dx*dx+dy*dy});
    }
  }
  candidates.sort((a,b)=>a.distance-b.distance);
  return candidates[0]?.positions||null;
}

/** Pack only one detected meld, preserving its left-to-right ID order and every other tile position. */
export function packRackGroupPositions(
  tileIds:number[],
  positions:Record<number,RackPoint>,
  geometry:RackGeometry,
  groupGap=MELD_GROUP_GAP,
):Record<number,RackPoint>|null {
  if(tileIds.length<2)return null;
  const width=Math.max(1,geometry.width),height=Math.max(1,geometry.height);
  const first=positions[tileIds[0]];
  if(!first)return null;
  const rail=first.y*height<height/2?'upper':'lower';
  const y=railCenterY(rail,geometry)/height;
  const groupSet=new Set(tileIds);
  const others=Object.entries(positions).filter(([id])=>!groupSet.has(Number(id))).map(([id,position])=>({tileId:Number(id),position}));
  const centers=xCenters(geometry,geometry.tileWidth,tileIds.length);
  const findWithGap=(gap:number):{start:number;distance:number}|null=>{
    let best:{start:number;distance:number}|null=null;
    for(const start of centers){
      const left=start-geometry.tileWidth/2;
      const right=start+(tileIds.length-1)*geometry.tileWidth+geometry.tileWidth/2;
      const tooClose=others.some(other=>{
        const otherY=other.position.y*height;
        if(Math.abs(otherY-y*height)>=geometry.tileHeight)return false;
        const otherCenter=other.position.x*width,otherLeft=otherCenter-geometry.tileWidth/2,otherRight=otherCenter+geometry.tileWidth/2;
        const edgeDistance=Math.max(left-otherRight,otherLeft-right);
        return edgeDistance<gap;
      });
      if(tooClose)continue;
      let distance=0;
      tileIds.forEach((id,index)=>{const current=positions[id];if(current)distance+=Math.abs(current.x*width-(start+index*geometry.tileWidth))});
      if(!best||distance<best.distance)best={start,distance};
    }
    return best;
  };
  const placement=findWithGap(groupGap)||findWithGap(0);
  if(!placement)return null;
  return Object.fromEntries(tileIds.map((id,index)=>[id,{x:(placement.start+index*geometry.tileWidth)/width,y}]));
}
