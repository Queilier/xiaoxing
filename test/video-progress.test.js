import test from 'node:test';import assert from 'node:assert/strict';
import { mergeRanges, hasFullCoverage } from '../public/video-progress.js';
test('完整播放可累计暂停、重播和切换后继续的时间区间',()=>{
 assert.deepEqual(mergeRanges([[0,10],[5,15],[15,20]]),[[0,20]]);
 assert.equal(hasFullCoverage([[0,10],[10,30]],30),true);
 assert.equal(hasFullCoverage([[0,30],[0,30]],30),true);
});
test('拖到末尾、缺失中段或未知时长不算完整播放',()=>{
 assert.equal(hasFullCoverage([[29,30]],30),false);
 assert.equal(hasFullCoverage([[0,10],[20,30]],30),false);
 assert.equal(hasFullCoverage([],30),false);
 assert.equal(hasFullCoverage([[0,30]],NaN),false);
});
