import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePositionedRackMelds, effectiveTile, findRackMeldGroups, findRackPairGroups, isValidPair, type RackGeometry, type RackTilePlacement, type Tile, type TileColor } from '../shared/game';
import { constrainRackPosition, findRackAutoSortGroups, getRackDragTileIds, initialRackPosition, layoutRackAutoSort, packRackGroupPositions, pointIsInsideDropZone, rackPositionIsAvailable, randomAvailableRackPosition, resolveRackDropPosition, resolveRackGroupDropPositions, retainRackPositionsForHand, selectRackAutoSortGroups, type PositionedRackTile } from '../shared/rack-layout';
import { dismissRackGroup, filterDismissedRackGroups, rackGroupId, retainDismissedRackGroupsAtSamePositions } from './rack-group-state';

const geometry:RackGeometry={width:1000,height:154,tileWidth:43,tileHeight:59};
const makeTile=(id:number,color:TileColor,number:number):Tile=>({id,color,number,fakeJoker:false});
const makeFakeJoker=(id:number):Tile=>({id,color:null,number:null,fakeJoker:true});
const placements=(tiles:Tile[],points:{x:number;y:number}[]):RackTilePlacement[]=>tiles.map((tile,index)=>({tile,position:{x:points[index].x/geometry.width,y:points[index].y/geometry.height}}));
const row=(tiles:Tile[],xs:number[],y=70)=>placements(tiles,xs.map(x=>({x,y})));
const analyze=(items:RackTilePlacement[],joker:null|{color:TileColor;number:number}=null)=>analyzePositionedRackMelds(items,geometry,joker);

test('üç taşlı geçerli seri',()=>{
  const tiles=[makeTile(1,'red',5),makeTile(2,'red',6),makeTile(3,'red',7)];
  const result=analyze(row(tiles,[100,150,200]));
  assert.deepEqual(result.groups,[[1,2,3]]);
  assert.equal(result.seriesTotal,18);
});

test('dört taşlı geçerli seri',()=>{
  const tiles=[makeTile(1,'blue',8),makeTile(2,'blue',9),makeTile(3,'blue',10),makeTile(4,'blue',11)];
  const result=analyze(row(tiles,[100,150,200,250]));
  assert.deepEqual(result.groups,[[1,2,3,4]]);
  assert.equal(result.seriesTotal,38);
});

test('geçerli çift algılanır ve seri toplamına eklenmez',()=>{
  const result=analyze(row([makeTile(1,'yellow',9),makeTile(2,'yellow',9)],[100,150]));
  assert.deepEqual(result.groups,[[1,2]]);
  assert.equal(result.pairCount,1);
  assert.equal(result.seriesTotal,0);
});

test('sayı sırası bozuk seri geçersiz kalır',()=>{
  const tiles=[makeTile(1,'black',1),makeTile(2,'black',3),makeTile(3,'black',2)];
  const result=analyze(row(tiles,[100,150,200]));
  assert.deepEqual(result.groups,[]);
  assert.equal(result.seriesTotal,0);
});

test('uzak iki grup birbirinden ayrı kalır',()=>{
  const tiles=[makeTile(1,'red',1),makeTile(2,'red',2),makeTile(3,'red',3),makeTile(4,'blue',7),makeTile(5,'blue',8),makeTile(6,'blue',9)];
  const result=analyze(row(tiles,[100,150,200,600,650,700]));
  assert.deepEqual(result.groups,[[1,2,3],[4,5,6]]);
});

test('üst ve alt sıradaki taşlar ayrı analiz edilir',()=>{
  const tiles=[makeTile(1,'red',1),makeTile(2,'red',2),makeTile(3,'red',3),makeTile(4,'blue',9),makeTile(5,'blue',10),makeTile(6,'blue',11)];
  const items=[...row(tiles.slice(0,3),[100,150,200],45),...row(tiles.slice(3),[100,150,200],115)];
  const result=analyze(items);
  assert.deepEqual(result.groups,[[1,2,3],[4,5,6]]);
});

test('gerçek okey taşı mevcut joker kuralıyla seriyi tamamlar',()=>{
  const tiles=[makeTile(1,'red',1),makeTile(2,'red',2),makeTile(3,'red',3),makeTile(4,'red',4)];
  const result=analyze(row(tiles,[100,150,200,250]),{color:'red',number:3});
  assert.deepEqual(result.groups,[[1,2,3,4]]);
  assert.equal(result.seriesTotal,10);
});

test('yakın ama farklı seriler ayrı gruplar olarak bulunur',()=>{
  const tiles=[makeTile(1,'black',2),makeTile(2,'black',3),makeTile(3,'black',4),makeTile(4,'blue',8),makeTile(5,'blue',9),makeTile(6,'blue',10)];
  const result=analyze(row(tiles,[100,150,200,275,325,375]));
  assert.deepEqual(result.groups,[[1,2,3],[4,5,6]]);
  const used=result.groups.flat();
  assert.equal(used.length,new Set(used).size,'hiçbir taş iki grupta kullanılmamalı');
});

test('15 piksellik grup boşluğu bitişik perleri birbirine karıştırmaz',()=>{
  const tiles=[makeTile(1,'red',1),makeTile(2,'red',2),makeTile(3,'red',3),makeTile(4,'red',4),makeTile(5,'red',5),makeTile(6,'red',6)];
  const result=analyze(row(tiles,[100,150,200,258,308,358]));
  assert.deepEqual(result.groups,[[1,2,3],[4,5,6]]);
});

test('taş sürüklenince fiziksel konuma göre seri yeniden hesaplanır',()=>{
  const tiles=[makeTile(1,'yellow',5),makeTile(2,'yellow',6),makeTile(3,'yellow',7)];
  assert.deepEqual(analyze(row(tiles,[100,150,200])).groups,[[1,2,3]]);
  assert.deepEqual(analyze(row(tiles,[100,500,200])).groups,[]);
});

test('perin ortasından taş çıkarılınca kalan kopuk parçalar geçersiz kalır',()=>{
  const tiles=[makeTile(1,'blue',4),makeTile(2,'blue',5),makeTile(3,'blue',6),makeTile(4,'blue',7),makeTile(5,'blue',8)];
  const remaining=tiles.filter(tile=>tile.id!==3);
  assert.deepEqual(analyze(row(remaining,[100,150,250,300])).groups,[]);
});

test('bırakış üst/alt raf sınırına alınır ve ıstaka dışına çıkmaz',()=>{
  const rackGeometry=geometry;
  const upper=constrainRackPosition({x:-1,y:.49},rackGeometry);
  const lower=constrainRackPosition({x:2,y:1.5},rackGeometry);
  const minX=(rackGeometry.tileWidth/2+8)/rackGeometry.width,maxX=(rackGeometry.width-rackGeometry.tileWidth/2-8)/rackGeometry.width;
  assert.ok(upper.x>=minX&&upper.x<=maxX);
  assert.ok(lower.x>=minX&&lower.x<=maxX);
  assert.ok(upper.y<.5&&lower.y>.5);
  assert.ok(upper.y*rackGeometry.height>=rackGeometry.tileHeight/2);
  assert.ok(lower.y*rackGeometry.height<=rackGeometry.height-rackGeometry.tileHeight/2);
});

test('yeni çekilen taş için rastgele boş raf yuvası seçilir ve çakışma oluşmaz',()=>{
  const occupied=[{tileId:901,position:initialRackPosition(0,2,geometry)}];
  const first=randomAvailableRackPosition(occupied,geometry,()=>0);
  const last=randomAvailableRackPosition(occupied,geometry,()=>.999999);
  assert.ok(first&&last);
  assert.notDeepEqual(first,last);
  assert.ok(rackPositionIsAvailable(first,occupied,geometry));
  assert.ok(rackPositionIsAvailable(last,occupied,geometry));
});

test('sürüklenen taş en yakın boş yuvaya gider, dolu yuva ile çakışmaz',()=>{
  const occupied:PositionedRackTile[]=[{tileId:1,position:{x:.1,y:.27}},{tileId:2,position:{x:.25,y:.27}}];
  const resolved=resolveRackDropPosition({x:.1,y:.27},occupied,geometry,3);
  assert.ok(resolved);
  assert.ok(occupied.every(tile=>Math.abs((tile.position.x-resolved.x)*geometry.width)>=geometry.tileWidth-.5||Math.abs((tile.position.y-resolved.y)*geometry.height)>=geometry.tileHeight-.5));
  assert.equal(Math.round(Math.abs((resolved.x-occupied[0].position.x)*geometry.width)),geometry.tileWidth);
  assert.ok(resolved.x*geometry.width>=geometry.tileWidth/2+8);
  assert.ok(resolved.x*geometry.width<=geometry.width-geometry.tileWidth/2-8);
});

test('22 taş iki sırada sıkı ve ortalı yerleşir; ardışık seri başlangıçta algılanır',()=>{
  const wideGeometry:RackGeometry={width:843,height:144,tileWidth:47,tileHeight:66};
  const positions=Array.from({length:22},(_,index)=>initialRackPosition(index,22,wideGeometry));
  const occupied:PositionedRackTile[]=[];
  positions.forEach((position,index)=>{
    assert.ok(rackPositionIsAvailable(position,occupied,wideGeometry,index+1),`taş ${index+1} için boş konum olmalı`);
    occupied.push({tileId:index+1,position});
  });
  assert.equal(Math.round((positions[1].x-positions[0].x)*wideGeometry.width),49);
  assert.equal(Math.round((positions[11].y-positions[0].y)*wideGeometry.height),67);
  const series=[makeTile(1,'red',5),makeTile(2,'red',6),makeTile(3,'red',7)];
  const analysis=analyzePositionedRackMelds(series.map((tile,index)=>({tile,position:positions[index]})),wideGeometry,null);
  assert.deepEqual(analysis.groups,[[1,2,3]]);
});

test('başlangıçta dağıtılmış 22 taşlı elde bırakma için boş konum bulunur',()=>{
  const wideGeometry:RackGeometry={width:843,height:144,tileWidth:47,tileHeight:66};
  const occupied:PositionedRackTile[]=Array.from({length:21},(_,index)=>({tileId:index+2,position:initialRackPosition(index+1,22,wideGeometry)}));
  const resolved=resolveRackDropPosition(initialRackPosition(0,22,wideGeometry),occupied,wideGeometry,1);
  assert.ok(resolved,'geniş ıstakada bırakma çözücüsü boş yuva bulmalı');
  assert.ok(rackPositionIsAvailable(resolved,occupied,wideGeometry,1));
});

test('atılan taşın bıraktığı raf konumu yeni çekilen taş için tekrar kullanılabilir',()=>{
  const wideGeometry:RackGeometry={width:843,height:144,tileWidth:47,tileHeight:66};
  const dealt=Array.from({length:22},(_,index)=>initialRackPosition(index,22,wideGeometry));
  const discardedIndex=10;
  const occupied:PositionedRackTile[]=dealt.flatMap((position,index)=>index===discardedIndex?[]:[{tileId:index+1,position}]);
  const resolved=resolveRackDropPosition(dealt[discardedIndex],occupied,wideGeometry,99);
  assert.ok(resolved,'çekilen taş için boşalan yer bulunmalı');
  assert.ok(rackPositionIsAvailable(resolved,occupied,wideGeometry,99));
  assert.ok(Math.abs((resolved.x-dealt[discardedIndex].x)*wideGeometry.width)<.01,'çözücü boşalan noktayı yeniden kullanmalı');
});

test('elde olmayan taşların eski koordinatları yeni el stateinden temizlenir',()=>{
  const previous={1:{x:.3,y:.27},2:{x:.4,y:.73},3:{x:.8,y:.73}};
  assert.deepEqual(retainRackPositionsForHand(previous,[1,3]),{1:previous[1],3:previous[3]});
});

test('farklı renkli aynı sayı üçlüsü fiziksel komşulukta per olur',()=>{
  const rackGeometry:RackGeometry={width:843,height:144,tileWidth:47,tileHeight:66};
  const tiles=[makeTile(1,'red',9),makeTile(2,'blue',9),makeTile(3,'black',9)];
  const first=initialRackPosition(0,22,rackGeometry);
  const items=tiles.map((tile,index)=>({tile,position:{x:first.x+index*49/rackGeometry.width,y:first.y}}));
  const result=analyzePositionedRackMelds(items,rackGeometry,null);
  assert.deepEqual(result.groups,[[1,2,3]]);
  assert.equal(result.seriesTotal,27);
});

test('fiziksel komşu aynı renk ve sayı çifti algılanır',()=>{
  const rackGeometry:RackGeometry={width:843,height:144,tileWidth:47,tileHeight:66};
  const tiles=[makeTile(1,'yellow',11),makeTile(2,'yellow',11)];
  const first=initialRackPosition(0,22,rackGeometry);
  const items=tiles.map((tile,index)=>({tile,position:{x:first.x+index*49/rackGeometry.width,y:first.y}}));
  const result=analyzePositionedRackMelds(items,rackGeometry,null);
  assert.deepEqual(result.groups,[[1,2]]);
  assert.equal(result.pairCount,1);
});

test('fiziksel olarak yan yana duran aynı taş ve gerçek okey geçerli çift olur',()=>{
  const joker={color:'yellow' as const,number:8},hand=[makeTile(1,'red',8),makeTile(2,'yellow',8),makeTile(3,'red',8)];
  const result=analyze(row(hand,[100,150,200]),joker);
  assert.deepEqual(result.groups,[[1,2]],'okey eksik kırmızı 8 eşinin yerine geçmeli');
  assert.equal(result.pairCount,1);
  assert.deepEqual(findRackMeldGroups(hand,joker),[[1,2]],'fiziksel raf grup analizi aynı kuralı kullanmalı');
});

test('gerçek okey farklı renk ve sayıdaki tek taşlarla da çift olabilir',()=>{
  const joker={color:'red' as const,number:4},realOkey=makeTile(99,'red',4);
  for(const natural of [makeTile(1,'blue',3),makeTile(2,'yellow',12),makeTile(3,'black',7)]){
    assert.equal(isValidPair([natural,realOkey],joker),true,`${natural.color} ${natural.number} gerçek okeyle eşleşebilmeli`);
    assert.deepEqual(findRackPairGroups([natural,realOkey],joker),[[natural.id,realOkey.id]]);
  }
});

test('iki aynı doğal taş ile gerçek okeyde en fazla iki taşlı grup oluşturulur',()=>{
  const joker={color:'blue' as const,number:3},hand=[makeTile(1,'red',8),makeTile(2,'red',8),makeTile(3,'blue',3)];
  const groups=findRackPairGroups(hand,joker);
  assert.equal(groups.length,1,'üç taş iki ayrı çift oluşturamaz');
  assert.equal(groups[0].length,2);
  assert.equal(new Set(groups.flat()).size,2,'taşlar birden fazla çifte atanmaz');
  assert.equal(isValidPair([hand[0],hand[2]],joker),true,'oyuncu gerçek okeyi doğal eş taşın yerine elle kullanabilmeli');
});

test('sahte okey joker değildir; yalnızca kendi temsil yüzüyle eşleşir',()=>{
  const joker={color:'yellow' as const,number:8},fake=makeFakeJoker(1),unrelated=makeTile(2,'blue',5);
  assert.equal(isValidPair([fake,unrelated],joker),false);
  assert.deepEqual(findRackPairGroups([fake,unrelated],joker),[]);
  assert.deepEqual(effectiveTile(fake,joker),{color:'yellow',number:8,wild:false});
  assert.equal(isValidPair([fake,makeTile(3,'yellow',8)],joker),true,'sahte okey temsil ettiği yüz olarak kullanılmalı');
});

test('otomatik çifti diz gerçek okeyi eksik eşin yerine kullanır',()=>{
  const joker={color:'black' as const,number:6},natural=makeTile(1,'blue',10),realOkey=makeTile(2,'black',6);
  assert.deepEqual(findRackAutoSortGroups([natural,realOkey],joker,'pairs'),[[1,2]]);
});

test('gerçek okeyli çift taş ayrılınca bozulur ve yeniden yan yana gelince algılanır',()=>{
  const rackGeometry:RackGeometry={width:843,height:144,tileWidth:47,tileHeight:66},joker={color:'black' as const,number:6};
  const hand=[makeTile(1,'red',10),makeTile(2,'black',6)];
  const start=initialRackPosition(0,22,rackGeometry),near=(dx:number)=>({x:start.x+dx/rackGeometry.width,y:start.y});
  const paired=analyzePositionedRackMelds(hand.map((tile,index)=>({tile,position:near(index*49)})),rackGeometry,joker);
  assert.deepEqual(paired.groups,[[1,2]]);
  const detached=analyzePositionedRackMelds(hand.map((tile,index)=>({tile,position:near(index===0?0:200)})),rackGeometry,joker);
  assert.deepEqual(detached.groups,[]);
  const regrouped=analyzePositionedRackMelds(hand.map((tile,index)=>({tile,position:near(index*49)})),rackGeometry,joker);
  assert.deepEqual(regrouped.groups,[[1,2]]);
});

test('sol tuş perin tamamını, sağ tuş yalnız seçili taşı sürükler',()=>{
  const group=[4,8,12,16];
  assert.deepEqual(getRackDragTileIds(8,group),group);
  assert.deepEqual(getRackDragTileIds(8,group,true),[8]);
  assert.deepEqual(getRackDragTileIds(99,group),[99]);
});

test('taş atma hedefi sınır içindeki bırakışı kabul eder ve dışarıyı reddeder',()=>{
  const bounds={left:100,top:200,right:150,bottom:260};
  assert.equal(pointIsInsideDropZone({x:100,y:200},bounds),true);
  assert.equal(pointIsInsideDropZone({x:150,y:260},bounds),true);
  assert.equal(pointIsInsideDropZone({x:151,y:260},bounds),false);
  assert.equal(pointIsInsideDropZone({x:125,y:199},bounds),false);
  assert.equal(pointIsInsideDropZone({x:125,y:220},null),false);
});

test('çift, üçlü ve dörtlü perler her üyesinden sürüklenince tek blok olarak yer değiştirir',()=>{
  for(const ids of [[1,2],[3,4,5],[6,7,8,9]]){
    const start:Record<number,{x:number;y:number}>={};
    ids.forEach((id,index)=>{start[id]={x:(120+index*51)/geometry.width,y:.27}});
    for(const anchor of ids){
      const result=resolveRackGroupDropPositions(ids,start,anchor,{x:.55,y:.73},[],geometry);
      assert.ok(result,`${ids.length} taşlı grup her taşından sürüklenince yerleşmeli`);
      const deltaX=(result[anchor].x-start[anchor].x)*geometry.width;
      const deltaY=(result[anchor].y-start[anchor].y)*geometry.height;
      for(const id of ids){
        assert.ok(Math.abs((result[id].x-start[id].x)*geometry.width-deltaX)<.01,'grup içi yatay mesafe korunmalı');
        assert.ok(Math.abs((result[id].y-start[id].y)*geometry.height-deltaY)<.01,'grup içi dikey mesafe korunmalı');
        assert.ok(result[id].y>.5,'grup istenen alt rafa geçmeli');
      }
    }
  }
});

test('grup kendi başlangıç taşlarını engel saymaz ve dış taşlarla çakışmayı önler',()=>{
  const ids=[1,2,3],start:Record<number,{x:number;y:number}>={1:{x:.2,y:.27},2:{x:.25,y:.27},3:{x:.3,y:.27}};
  const ownTiles:PositionedRackTile[]=ids.map(tileId=>({tileId,position:start[tileId]}));
  const selfOverlap=resolveRackGroupDropPositions(ids,start,1,{x:.25,y:.27},ownTiles,geometry);
  assert.ok(selfOverlap,'grup kendi üyeleriyle çakışma yaşamamalı');
  assert.equal(Math.round((selfOverlap[2].x-selfOverlap[1].x)*geometry.width),50);
  const external:PositionedRackTile[]=[...ownTiles,{tileId:99,position:{x:.27,y:.27}}];
  const moved=resolveRackGroupDropPositions(ids,start,1,{x:.25,y:.27},external,geometry);
  assert.ok(moved);
  for(const id of ids){
    const overlapsBlocker:boolean=Math.abs((moved[id].x-external[3].position.x)*geometry.width)<geometry.tileWidth-.5&&Math.abs((moved[id].y-external[3].position.y)*geometry.height)<geometry.tileHeight-.5;
    assert.equal(overlapsBlocker,false,'grup dışındaki dolu taşla çakışmamalı');
  }
  assert.equal(Math.round((moved[2].x-moved[1].x)*geometry.width),50,'grup içi mesafe korunmalı');
});

test('per dizilimi yalnızca per taşlarını sıkıştırır ve diğer koordinatları korur',()=>{
  const positions:Record<number,{x:number;y:number}>={
    1:{x:.12,y:.27},2:{x:.2,y:.27},3:{x:.28,y:.27},4:{x:.6,y:.27},
  };
  const otherBefore={...positions[4]};
  const packed=packRackGroupPositions([1,2,3],positions,geometry);
  assert.ok(packed);
  assert.deepEqual(positions[4],otherBefore);
  const xs=[packed[1].x,packed[2].x,packed[3].x];
  assert.equal(Math.round((xs[1]-xs[0])*geometry.width),geometry.tileWidth);
  assert.equal(Math.round((xs[2]-xs[1])*geometry.width),geometry.tileWidth);
  assert.equal(packed[1].y,packed[2].y);
  assert.equal(packed[2].y,packed[3].y);
});

test('X ile ayrılan grup aynı konumlarda gizli kalır ve taş hareket edince yeniden analiz edilir',()=>{
  const positions:Record<number,{x:number;y:number}>={1:{x:.2,y:.27},2:{x:.25,y:.27},3:{x:.3,y:.27}};
  const groups=[{id:rackGroupId([1,2,3]),tileIds:[1,2,3]},{id:rackGroupId([4,5]),tileIds:[4,5]}];
  const dismissed=dismissRackGroup([],groups[0].tileIds,positions);
  assert.equal(dismissed.length,1);
  assert.equal(dismissRackGroup(dismissed,groups[0].tileIds,positions),dismissed,'tekrarlı X kaydı çoğaltmamalı');
  const unchanged=retainDismissedRackGroupsAtSamePositions(dismissed,{...positions,1:{...positions[1]}});
  assert.equal(unchanged.length,1);
  assert.deepEqual(filterDismissedRackGroups(groups,unchanged).map(group=>group.id),[groups[1].id]);

  const moved=retainDismissedRackGroupsAtSamePositions(unchanged,{...positions,2:{x:.35,y:.27}});
  assert.equal(moved.length,0);
  assert.deepEqual(filterDismissedRackGroups(groups,moved).map(group=>group.id),groups.map(group=>group.id));
});

test('seri diz bir eldeki birden fazla geçerli seriyi seçer',()=>{
  const tiles=[makeTile(1,'red',1),makeTile(2,'red',2),makeTile(3,'red',3),makeTile(4,'blue',8),makeTile(5,'blue',9),makeTile(6,'blue',10),makeTile(7,'black',13)];
  const groups=findRackAutoSortGroups(tiles,null,'series');
  assert.deepEqual(groups,[[1,2,3],[4,5,6]]);
  assert.equal(new Set(groups.flat()).size,6,'bir taş iki seriye girmemeli');
});

test('seri DP puanı önceleyerek 15 taşlı 120 puan çözümünü 18 taşlı 110 puan çözümüne tercih eder',()=>{
  const tileIds=Array.from({length:18},(_,index)=>index+1);
  const groups=selectRackAutoSortGroups(tileIds,[
    {tileIds:[1,2,3,4,5,6,7,8],score:64},
    {tileIds:[9,10,11,12,13,14,15],score:56},
    {tileIds:[1,2,3,4,9,10,11,12,13],score:55},
    {tileIds:[5,6,7,8,14,15,16,17,18],score:55},
  ]);
  assert.deepEqual(groups,[[1,2,3,4,5,6,7,8],[9,10,11,12,13,14,15]]);
});

test('seri DP eşit puanda daha fazla taşı gruplar',()=>{
  assert.deepEqual(selectRackAutoSortGroups([1,2,3,4],[
    {tileIds:[1,2,3],score:27},
    {tileIds:[1,2,3,4],score:27},
  ]),[[1,2,3,4]]);
});

test('seri DP eşit puan ve taş sayısında daha az grubu seçer',()=>{
  assert.deepEqual(selectRackAutoSortGroups([1,2,3,4,5,6],[
    {tileIds:[1,2,3,4,5,6],score:39},
    {tileIds:[1,2,3],score:15},
    {tileIds:[4,5,6],score:24},
  ]),[[1,2,3,4,5,6]]);
});

test('22 taşlık tam kombinasyonlarda DP yüksek toplam puanı seçer ve taşları çoğaltmaz',()=>{
  const tileIds=Array.from({length:22},(_,index)=>index+1);
  const groups=selectRackAutoSortGroups(tileIds,[
    {tileIds:[1,2,3,4,5,6,7,8],score:100},
    {tileIds:[9,10,11,12,13,14,15],score:80},
    {tileIds:[16,17,18,19,20,21,22],score:0},
    {tileIds:[1,2,3,4,9,10,11,12,13],score:85},
    {tileIds:[5,6,7,8,14,15,16,17,18],score:85},
    {tileIds:[19,20,21,22],score:0},
  ]);
  const selected=groups.flat();
  assert.deepEqual(groups,[[1,2,3,4,5,6,7,8],[9,10,11,12,13,14,15],[16,17,18,19,20,21,22]]);
  const scores=new Map([
    ['1,2,3,4,5,6,7,8',100],['9,10,11,12,13,14,15',80],['16,17,18,19,20,21,22',0],
    ['1,2,3,4,9,10,11,12,13',85],['5,6,7,8,14,15,16,17,18',85],['19,20,21,22',0],
  ]);
  assert.equal(groups.reduce((sum,group)=>sum+(scores.get([...group].sort((a,b)=>a-b).join(','))??0),0),180);
  assert.equal(new Set(selected).size,selected.length);
  assert.ok(selected.length<=22);
});

test('seri diz aynı sayıdaki üç farklı rengi grup olarak bulur',()=>{
  const tiles=[makeTile(1,'red',13),makeTile(2,'blue',13),makeTile(3,'black',13)];
  assert.deepEqual(findRackAutoSortGroups(tiles,null,'series'),[[1,2,3]]);
});

test('seri diz aynı sayı grubundaki eksik rengi gerçek okeyle tamamlar',()=>{
  const joker={color:'yellow' as const,number:5};
  const tiles=[makeTile(1,'red',13),makeTile(2,'blue',13),makeTile(3,'yellow',5)];
  assert.deepEqual(findRackAutoSortGroups(tiles,joker,'series').map(group=>[...group].sort((a,b)=>a-b)),[[1,2,3]]);
});

test('seri diz gerçek okeyi 13 puanlı gruba verir, 10 puanlı alternatifi seçmez',()=>{
  const joker={color:'yellow' as const,number:5};
  const tiles=[makeTile(1,'red',10),makeTile(2,'blue',10),makeTile(3,'red',13),makeTile(4,'blue',13),makeTile(5,'yellow',5)];
  assert.deepEqual(findRackAutoSortGroups(tiles,joker,'series').map(group=>[...group].sort((a,b)=>a-b)),[[3,4,5]]);
});

test('seri diz dört farklı renkteki aynı sayıyı grup olarak bulur',()=>{
  const tiles=[makeTile(1,'red',13),makeTile(2,'yellow',13),makeTile(3,'blue',13),makeTile(4,'black',13)];
  assert.deepEqual(findRackAutoSortGroups(tiles,null,'series'),[[1,2,3,4]]);
});

test('aynı sayı grubunda aynı renk tekrarı farklı renk sayılmaz',()=>{
  const tiles=[makeTile(1,'red',13),makeTile(2,'red',13),makeTile(3,'blue',13)];
  assert.deepEqual(findRackAutoSortGroups(tiles,null,'series'),[]);
});

test('seri diz aynı elde hem ardışık serileri hem farklı renk sayı gruplarını bulur ve puanları korur',()=>{
  const rackGeometry:RackGeometry={width:843,height:144,tileWidth:47,tileHeight:66};
  const tiles=[makeTile(1,'red',1),makeTile(2,'red',2),makeTile(3,'red',3),makeTile(4,'red',13),makeTile(5,'blue',13),makeTile(6,'black',13)];
  const groups=findRackAutoSortGroups(tiles,null,'series');
  assert.deepEqual(groups,[[1,2,3],[4,5,6]]);
  const positions=layoutRackAutoSort(tiles,groups,rackGeometry);
  assert.ok(positions);
  const analysis=analyzePositionedRackMelds(tiles.map(tile=>({tile,position:positions[tile.id]})),rackGeometry,null);
  assert.deepEqual(analysis.groups,groups);
  assert.equal(analysis.seriesTotal,45,'gri grup çubuklarının puan kaynağı mevcut analiz olmalı');
});

test('sahte okey yalnızca temsil ettiği taş yüzünü kullanır, eksik renk jokeri olmaz',()=>{
  const joker={color:'red' as const,number:7};
  const tiles=[makeTile(1,'red',13),makeTile(2,'blue',13),makeFakeJoker(3)];
  assert.deepEqual(findRackAutoSortGroups(tiles,joker,'series'),[]);
  assert.deepEqual(effectiveTile(tiles[2],joker),{color:'red',number:7,wild:false});
});

test('çifti diz aynı taşlardan birden fazla çifti seçer ve artan taşı elde bırakır',()=>{
  const tiles=[makeTile(1,'yellow',8),makeTile(2,'yellow',8),makeTile(3,'black',4),makeTile(4,'black',4),makeTile(5,'blue',12)];
  const groups=findRackAutoSortGroups(tiles,null,'pairs');
  assert.deepEqual(groups,[[1,2],[3,4]]);
  assert.deepEqual(tiles.filter(tile=>!groups.flat().includes(tile.id)).map(tile=>tile.id),[5]);
});

test('çifti diz gerçek okeyi en yüksek değerli uygun tek taşla eşleştirir',()=>{
  const joker={color:'yellow' as const,number:5};
  const tiles=[makeTile(1,'red',3),makeTile(2,'blue',12),makeTile(3,'black',9),makeTile(4,'yellow',5)];
  assert.deepEqual(findRackAutoSortGroups(tiles,joker,'pairs'),[[2,4]]);
});

test('seri ve çift diz aynı elde yalnızca seçilen moda ait grupları üretir',()=>{
  const tiles=[makeTile(1,'red',4),makeTile(2,'red',5),makeTile(3,'red',6),makeTile(4,'yellow',9),makeTile(5,'yellow',9),makeTile(6,'blue',2)];
  assert.deepEqual(findRackAutoSortGroups(tiles,null,'series'),[[1,2,3]]);
  assert.deepEqual(findRackAutoSortGroups(tiles,null,'pairs'),[[4,5]]);
  assert.deepEqual(findRackAutoSortGroups(tiles,null,'series'),[[1,2,3]],'moda geri dönünce aynı grup seçilmeli');
});

test('seri diz gerçek okeyi joker, sahte okeyi temsil ettiği yüz olarak değerlendirir',()=>{
  const realOkeyHand=[makeTile(1,'red',5),makeTile(2,'red',6),makeTile(3,'red',4),makeTile(4,'red',8)];
  const realOkeyGroups=findRackAutoSortGroups(realOkeyHand,{color:'red',number:4},'series');
  assert.deepEqual(realOkeyGroups,[[1,2,3,4]],'gerçek okey kırmızı 7 yerine geçebilmeli');

  const fakeOkeyHand=[makeTile(5,'red',5),makeTile(6,'red',6),makeFakeJoker(7),makeTile(8,'blue',1)];
  const fakeOkeyGroups=findRackAutoSortGroups(fakeOkeyHand,{color:'red',number:7},'series');
  assert.deepEqual(fakeOkeyGroups,[[5,6,7]],'sahte okey yalnızca temsil ettiği kırmızı 7 yüzüyle eşleşmeli');
});

test('çifti diz mevcut çift kurallarına göre sahte okey çiftini tanır',()=>{
  const tiles=[makeFakeJoker(1),makeFakeJoker(2),makeTile(3,'red',7)];
  assert.deepEqual(findRackAutoSortGroups(tiles,{color:'red',number:7},'pairs'),[[1,2]]);
});

test('seri diz 22 taşlık çift kopyalı elde taş kimliklerini tekrarlamaz',()=>{
  const tiles:Tile[]=[];
  for(let number=1;number<=10;number++)for(let copy=0;copy<2;copy++)tiles.push(makeTile(tiles.length+1,'red',number));
  tiles.push(makeTile(tiles.length+1,'red',11));
  tiles.push(makeTile(tiles.length+1,'red',11));
  const groups=findRackAutoSortGroups(tiles,{color:'red',number:11},'series'),groupedIds=groups.flat();
  assert.equal(new Set(groupedIds).size,groupedIds.length,`taş birden fazla seri grubuna girmemeli: ${JSON.stringify(groups)}`);
  assert.ok(groupedIds.length>=20,'mümkün olan uzun serilerde eldeki taşların çoğu gruplandırılmalı');
});

test('otomatik dizim tüm taşları iki rafa yerleştirir, çakıştırmaz ve tekrarlandığında aynı sonucu verir',()=>{
  const rackGeometry:RackGeometry={width:843,height:144,tileWidth:47,tileHeight:66};
  const tiles=[makeTile(1,'red',1),makeTile(2,'red',2),makeTile(3,'red',3),makeTile(4,'blue',7),makeTile(5,'blue',8),makeTile(6,'blue',9),makeTile(7,'black',1),makeTile(8,'yellow',6),makeTile(9,'red',13)];
  const groups=findRackAutoSortGroups(tiles,null,'series');
  const first=layoutRackAutoSort(tiles,groups,rackGeometry),second=layoutRackAutoSort(tiles,groups,rackGeometry);
  assert.ok(first);
  assert.deepEqual(first,second,'aynı el ve mod deterministik yerleşmeli');
  assert.deepEqual(Object.keys(first).map(Number).sort((a,b)=>a-b),tiles.map(tile=>tile.id).sort((a,b)=>a-b),'gruplu ve tekli bütün taşlar korunmalı');
  const occupied:PositionedRackTile[]=[];
  for(const tile of tiles){
    const position=first[tile.id];
    assert.ok(rackPositionIsAvailable(position,occupied,rackGeometry,tile.id),`taş ${tile.id} ıstaka içinde boş konumda olmalı`);
    occupied.push({tileId:tile.id,position});
  }
  const detected=analyzePositionedRackMelds(tiles.map(tile=>({tile,position:first[tile.id]})),rackGeometry,null).groups;
  assert.deepEqual(detected,groups,'seçilen gruplar ıstaka analizinde tekrar görünmeli');
});
