var async = require('async');
var _ = require('lodash');

var db = require('../database');
var user = require('../user');
var notifications = require('../notifications');
var categories = require('../categories');
var privileges = require('../privileges');
var meta = require('../meta');
var utils = require('../utils');
var plugins = require('../plugins');

module.exports = (Topics) => {
	Topics.getTotalUnread = (uid, filter, callback) => {
		if (!callback) {
			callback = filter;
			filter = '';
		}
		Topics.getUnreadTids({ cid: 0, uid: uid, filter: filter }, (err, tids) => {
			callback(err, Array.isArray(tids) ? tids.length : 0);
		});
	};

	Topics.getUnreadTopics = (params, callback) => {
		var unreadTopics = {
			showSelect: true,
			nextStart: 0,
			topics: [],
		};

		async.waterfall([
			(next) => {
				Topics.getUnreadTids(params, next);
			},
			(tids, next) => {
				unreadTopics.topicCount = tids.length;

				if (!tids.length) {
					return next(null, []);
				}

				if (params.stop === -1) {
					tids = tids.slice(params.start);
				} else {
					tids = tids.slice(params.start, params.stop + 1);
				}

				Topics.getTopicsByTids(tids, params.uid, next);
			},
			(topicData, next) => {
				if (!topicData.length) {
					return next(null, unreadTopics);
				}

				unreadTopics.topics = topicData;
				unreadTopics.nextStart = params.stop + 1;
				next(null, unreadTopics);
			},
		], callback);
	};

	Topics.unreadCutoff = () => {
		var cutoff = parseInt(meta.config.unreadCutoff, 10) || 2;
		return Date.now() - (cutoff * 86400000);
	};

	Topics.getUnreadTids = (params, callback) => {
		var uid = parseInt(params.uid, 10);
		if (uid === 0) {
			return callback(null, []);
		}

		var cutoff = params.cutoff || Topics.unreadCutoff();

		if (params.cid && !Array.isArray(params.cid)) {
			params.cid = [params.cid];
		}

		async.waterfall([
			(next) => {
				async.parallel({
					ignoredTids: (next) => {
						user.getIgnoredTids(uid, 0, -1, next);
					},
					recentTids: (next) => {
						db.getSortedSetRevRangeByScoreWithScores('topics:recent', 0, -1, '+inf', cutoff, next);
					},
					userScores: (next) => {
						db.getSortedSetRevRangeByScoreWithScores('uid:' + uid + ':tids_read', 0, -1, '+inf', cutoff, next);
					},
					tids_unread: (next) => {
						db.getSortedSetRevRangeWithScores('uid:' + uid + ':tids_unread', 0, -1, next);
					},
				}, next);
			},
			(results, next) => {
				if (results.recentTids && !results.recentTids.length && !results.tids_unread.length) {
					return callback(null, []);
				}

				var userRead = {};
				results.userScores.forEach((userItem) => {
					userRead[userItem.value] = userItem.score;
				});

				results.recentTids = results.recentTids.concat(results.tids_unread);
				results.recentTids.sort((a, b) => b.score - a.score);

				var tids = results.recentTids.filter((recentTopic) => {
					if (results.ignoredTids.indexOf(recentTopic.value.toString()) !== -1) {
						return false;
					}
					switch (params.filter) {
					case 'new':
						return !userRead[recentTopic.value];
					default:
						return !userRead[recentTopic.value] || recentTopic.score > userRead[recentTopic.value];
					}
				}).map(topic => topic.value);

				tids = _.uniq(tids);

				if (params.filter === 'watched') {
					Topics.filterWatchedTids(tids, uid, next);
				} else if (params.filter === 'unreplied') {
					Topics.filterUnrepliedTids(tids, next);
				} else {
					next(null, tids);
				}
			},
			(tids, next) => {
				tids = tids.slice(0, 200);

				filterTopics(uid, tids, params.cid, params.filter, next);
			},
			(tids, next) => {
				plugins.fireHook('filter:topics.getUnreadTids', {
					uid: uid,
					tids: tids,
					cid: params.cid,
					filter: params.filter,
				}, next);
			},
			(results, next) => {
				next(null, results.tids);
			},
		], callback);
	};


	function filterTopics(uid, tids, cid, filter, callback) {
		if (!tids.length) {
			return callback(null, tids);
		}

		async.waterfall([
			(next) => {
				privileges.topics.filterTids('read', tids, uid, next);
			},
			(tids, next) => {
				async.parallel({
					topics: (next) => {
						Topics.getTopicsFields(tids, ['tid', 'cid'], next);
					},
					isTopicsFollowed: (next) => {
						if (filter === 'watched' || filter === 'new') {
							return next(null, []);
						}
						db.sortedSetScores('uid:' + uid + ':followed_tids', tids, next);
					},
					ignoredCids: (next) => {
						if (filter === 'watched') {
							return next(null, []);
						}
						user.getIgnoredCategories(uid, next);
					},
				}, next);
			},
			(results, next) => {
				var topics = results.topics;
				cid = cid && cid.map(String);
				tids = topics.filter((topic, index) => topic && topic.cid &&
						(!!results.isTopicsFollowed[index] || results.ignoredCids.indexOf(topic.cid.toString()) === -1) &&
						(!cid || (cid.length && cid.indexOf(String(topic.cid)) !== -1))).map(topic => topic.tid);
				next(null, tids);
			},
		], callback);
	}

	Topics.pushUnreadCount = (uid, callback) => {
		callback = callback || function () {};

		if (!uid || parseInt(uid, 10) === 0) {
			return setImmediate(callback);
		}

		async.waterfall([
			(next) => {
				async.parallel({
					unreadTopicCount: async.apply(Topics.getTotalUnread, uid),
					unreadNewTopicCount: async.apply(Topics.getTotalUnread, uid, 'new'),
					unreadWatchedTopicCount: async.apply(Topics.getTotalUnread, uid, 'watched'),
				}, next);
			},
			(results, next) => {
				require('../socket.io').in('uid_' + uid).emit('event:unread.updateCount', results);
				setImmediate(next);
			},
		], callback);
	};

	Topics.markAsUnreadForAll = (tid, callback) => {
		Topics.markCategoryUnreadForAll(tid, callback);
	};

	Topics.markAsRead = (tids, uid, callback) => {
		callback = callback || function () {};
		if (!Array.isArray(tids) || !tids.length) {
			return setImmediate(callback, null, false);
		}

		tids = _.uniq(tids).filter(tid => tid && utils.isNumber(tid));

		if (!tids.length) {
			return setImmediate(callback, null, false);
		}

		async.waterfall([
			(next) => {
				async.parallel({
					topicScores: async.apply(db.sortedSetScores, 'topics:recent', tids),
					userScores: async.apply(db.sortedSetScores, 'uid:' + uid + ':tids_read', tids),
				}, next);
			},
			(results, next) => {
				tids = tids.filter((tid, index) => results.topicScores[index] && (!results.userScores[index] || results.userScores[index] < results.topicScores[index]));

				if (!tids.length) {
					return callback(null, false);
				}

				var now = Date.now();
				var scores = tids.map(() => now);

				async.parallel({
					markRead: async.apply(db.sortedSetAdd, 'uid:' + uid + ':tids_read', scores, tids),
					markUnread: async.apply(db.sortedSetRemove, 'uid:' + uid + ':tids_unread', tids),
					topicData: async.apply(Topics.getTopicsFields, tids, ['cid']),
				}, next);
			},
			(results, next) => {
				var cids = results.topicData.map(topic => topic && topic.cid).filter(Boolean);

				cids = _.uniq(cids);

				categories.markAsRead(cids, uid, next);
			},
			(next) => {
				plugins.fireHook('action:topics.markAsRead', { uid: uid, tids: tids });
				next(null, true);
			},
		], callback);
	};

	Topics.markAllRead = (uid, callback) => {
		async.waterfall([
			(next) => {
				db.getSortedSetRevRangeByScore('topics:recent', 0, -1, '+inf', Topics.unreadCutoff(), next);
			},
			(tids, next) => {
				Topics.markTopicNotificationsRead(tids, uid);
				Topics.markAsRead(tids, uid, next);
			},
			(markedRead, next) => {
				db.delete('uid:' + uid + ':tids_unread', next);
			},
		], callback);
	};

	Topics.markTopicNotificationsRead = (tids, uid, callback) => {
		callback = callback || function () {};
		if (!Array.isArray(tids) || !tids.length) {
			return callback();
		}

		async.waterfall([
			(next) => {
				user.notifications.getUnreadByField(uid, 'tid', tids, next);
			},
			(nids, next) => {
				notifications.markReadMultiple(nids, uid, next);
			},
			(next) => {
				user.notifications.pushCount(uid);
				next();
			},
		], callback);
	};

	Topics.markCategoryUnreadForAll = (tid, callback) => {
		async.waterfall([
			(next) => {
				Topics.getTopicField(tid, 'cid', next);
			},
			(cid, next) => {
				categories.markAsUnreadForAll(cid, next);
			},
		], callback);
	};

	Topics.hasReadTopics = (tids, uid, callback) => {
		if (!parseInt(uid, 10)) {
			return callback(null, tids.map(() => false));
		}

		async.waterfall([
			(next) => {
				async.parallel({
					recentScores: (next) => {
						db.sortedSetScores('topics:recent', tids, next);
					},
					userScores: (next) => {
						db.sortedSetScores('uid:' + uid + ':tids_read', tids, next);
					},
					tids_unread: (next) => {
						db.sortedSetScores('uid:' + uid + ':tids_unread', tids, next);
					},
				}, next);
			},
			(results, next) => {
				var cutoff = Topics.unreadCutoff();
				var result = tids.map((tid, index) => !results.tids_unread[index] &&
						(results.recentScores[index] < cutoff ||
						!!(results.userScores[index] && results.userScores[index] >= results.recentScores[index])));

				next(null, result);
			},
		], callback);
	};

	Topics.hasReadTopic = (tid, uid, callback) => {
		Topics.hasReadTopics([tid], uid, (err, hasRead) => {
			callback(err, Array.isArray(hasRead) && hasRead.length ? hasRead[0] : false);
		});
	};

	Topics.markUnread = (tid, uid, callback) => {
		async.waterfall([
			(next) => {
				Topics.exists(tid, next);
			},
			(exists, next) => {
				if (!exists) {
					return next(new Error('[[error:no-topic]]'));
				}
				db.sortedSetRemove('uid:' + uid + ':tids_read', tid, next);
			},
			(next) => {
				db.sortedSetAdd('uid:' + uid + ':tids_unread', Date.now(), tid, next);
			},
		], callback);
	};

	Topics.filterNewTids = (tids, uid, callback) => {
		async.waterfall([
			(next) => {
				db.sortedSetScores('uid:' + uid + ':tids_read', tids, next);
			},
			(scores, next) => {
				tids = tids.filter((tid, index) => tid && !scores[index]);
				next(null, tids);
			},
		], callback);
	};

	Topics.filterUnrepliedTids = (tids, callback) => {
		async.waterfall([
			(next) => {
				db.sortedSetScores('topics:posts', tids, next);
			},
			(scores, next) => {
				tids = tids.filter((tid, index) => tid && scores[index] <= 1);
				next(null, tids);
			},
		], callback);
	};
};
