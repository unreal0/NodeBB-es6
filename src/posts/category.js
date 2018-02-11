var async = require('async');
var _ = require('lodash');

var db = require('../database');
var topics = require('../topics');

module.exports = (Posts) => {
	Posts.getCidByPid = (pid, callback) => {
		async.waterfall([
			(next) => {
				Posts.getPostField(pid, 'tid', next);
			},
			(tid, next) => {
				topics.getTopicField(tid, 'cid', next);
			},
		], callback);
	};

	Posts.getCidsByPids = (pids, callback) => {
		var tids;
		var postData;
		async.waterfall([
			(next) => {
				Posts.getPostsFields(pids, ['tid'], next);
			},
			(_postData, next) => {
				postData = _postData;
				tids = _.uniq(postData.map(post => post && post.tid).filter(Boolean));

				topics.getTopicsFields(tids, ['cid'], next);
			},
			(topicData, next) => {
				var map = {};
				topicData.forEach((topic, index) => {
					if (topic) {
						map[tids[index]] = topic.cid;
					}
				});

				var cids = postData.map(post => map[post.tid]);
				next(null, cids);
			},
		], callback);
	};

	Posts.filterPidsByCid = (pids, cid, callback) => {
		if (!cid) {
			return setImmediate(callback, null, pids);
		}

		if (!Array.isArray(cid) || cid.length === 1) {
			return filterPidsBySingleCid(pids, cid, callback);
		}

		async.waterfall([
			(next) => {
				async.map(cid, (cid, next) => {
					Posts.filterPidsByCid(pids, cid, next);
				}, next);
			},
			(pidsArr, next) => {
				next(null, _.union.apply(_, pidsArr));
			},
		], callback);
	};

	function filterPidsBySingleCid(pids, cid, callback) {
		async.waterfall([
			(next) => {
				db.isSortedSetMembers('cid:' + parseInt(cid, 10) + ':pids', pids, next);
			},
			(isMembers, next) => {
				pids = pids.filter((pid, index) => pid && isMembers[index]);
				next(null, pids);
			},
		], callback);
	}
};
