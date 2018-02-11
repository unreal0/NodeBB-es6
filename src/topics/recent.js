var async = require('async');

var db = require('../database');
var plugins = require('../plugins');
var privileges = require('../privileges');
var user = require('../user');
var meta = require('../meta');

module.exports = (Topics) => {
	var terms = {
		day: 86400000,
		week: 604800000,
		month: 2592000000,
		year: 31104000000,
	};

	Topics.getRecentTopics = (cid, uid, start, stop, filter, callback) => {
		var recentTopics = {
			nextStart: 0,
			topics: [],
		};
		if (cid && !Array.isArray(cid)) {
			cid = [cid];
		}
		async.waterfall([
			(next) => {
				var key = 'topics:recent';
				if (cid) {
					key = cid.map(cid => 'cid:' + cid + ':tids:lastposttime');
				}
				db.getSortedSetRevRange(key, 0, 199, next);
			},
			(tids, next) => {
				filterTids(tids, uid, filter, cid, next);
			},
			(tids, next) => {
				recentTopics.topicCount = tids.length;
				tids = tids.slice(start, stop + 1);
				Topics.getTopicsByTids(tids, uid, next);
			},
			(topicData, next) => {
				recentTopics.topics = topicData;
				recentTopics.nextStart = stop + 1;
				next(null, recentTopics);
			},
		], callback);
	};

	function filterTids(tids, uid, filter, cid, callback) {
		async.waterfall([
			(next) => {
				if (filter === 'watched') {
					Topics.filterWatchedTids(tids, uid, next);
				} else if (filter === 'new') {
					Topics.filterNewTids(tids, uid, next);
				} else if (filter === 'unreplied') {
					Topics.filterUnrepliedTids(tids, next);
				} else {
					Topics.filterNotIgnoredTids(tids, uid, next);
				}
			},
			(tids, next) => {
				privileges.topics.filterTids('read', tids, uid, next);
			},
			(tids, next) => {
				async.parallel({
					ignoredCids: (next) => {
						if (filter === 'watched' || parseInt(meta.config.disableRecentCategoryFilter, 10) === 1) {
							return next(null, []);
						}
						user.getIgnoredCategories(uid, next);
					},
					topicData: (next) => {
						Topics.getTopicsFields(tids, ['tid', 'cid'], next);
					},
				}, next);
			},
			(results, next) => {
				cid = cid && cid.map(String);
				tids = results.topicData.filter((topic) => {
					if (topic && topic.cid) {
						return results.ignoredCids.indexOf(topic.cid.toString()) === -1 && (!cid || (cid.length && cid.indexOf(topic.cid.toString()) !== -1));
					}
					return false;
				}).map(topic => topic.tid);
				next(null, tids);
			},
		], callback);
	}

	/* not an orphan method, used in widget-essentials */
	Topics.getLatestTopics = (uid, start, stop, term, callback) => {
		async.waterfall([
			(next) => {
				Topics.getLatestTidsFromSet('topics:recent', start, stop, term, next);
			},
			(tids, next) => {
				Topics.getTopics(tids, uid, next);
			},
			(topics, next) => {
				next(null, { topics: topics, nextStart: stop + 1 });
			},
		], callback);
	};

	Topics.getLatestTidsFromSet = (set, start, stop, term, callback) => {
		var since = terms.day;
		if (terms[term]) {
			since = terms[term];
		}

		var count = parseInt(stop, 10) === -1 ? stop : stop - start + 1;

		db.getSortedSetRevRangeByScore(set, start, count, '+inf', Date.now() - since, callback);
	};

	Topics.updateTimestamp = (tid, timestamp, callback) => {
		async.parallel([
			(next) => {
				var topicData;
				async.waterfall([
					(next) => {
						Topics.getTopicFields(tid, ['cid', 'deleted'], next);
					},
					(_topicData, next) => {
						topicData = _topicData;
						db.sortedSetAdd('cid:' + topicData.cid + ':tids:lastposttime', timestamp, tid, next);
					},
					(next) => {
						if (parseInt(topicData.deleted, 10) === 1) {
							return next();
						}
						Topics.updateRecent(tid, timestamp, next);
					},
				], next);
			},
			(next) => {
				Topics.setTopicField(tid, 'lastposttime', timestamp, next);
			},
		], (err) => {
			callback(err);
		});
	};

	Topics.updateRecent = (tid, timestamp, callback) => {
		callback = callback || function () {};

		async.waterfall([
			(next) => {
				if (plugins.hasListeners('filter:topics.updateRecent')) {
					plugins.fireHook('filter:topics.updateRecent', { tid: tid, timestamp: timestamp }, next);
				} else {
					next(null, { tid: tid, timestamp: timestamp });
				}
			},
			(data, next) => {
				if (data && data.tid && data.timestamp) {
					db.sortedSetAdd('topics:recent', data.timestamp, data.tid, next);
				} else {
					next();
				}
			},
		], callback);
	};
};
