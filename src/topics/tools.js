var async = require('async');
var _ = require('lodash');

var db = require('../database');
var categories = require('../categories');
var plugins = require('../plugins');
var privileges = require('../privileges');


module.exports = (Topics) => {
	var topicTools = {};
	Topics.tools = topicTools;

	topicTools.delete = (tid, uid, callback) => {
		toggleDelete(tid, uid, true, callback);
	};

	topicTools.restore = (tid, uid, callback) => {
		toggleDelete(tid, uid, false, callback);
	};

	function toggleDelete(tid, uid, isDelete, callback) {
		var topicData;
		async.waterfall([
			(next) => {
				Topics.exists(tid, next);
			},
			(exists, next) => {
				if (!exists) {
					return next(new Error('[[error:no-topic]]'));
				}
				privileges.topics.canDelete(tid, uid, next);
			},
			(canDelete, next) => {
				if (!canDelete) {
					return next(new Error('[[error:no-privileges]]'));
				}
				Topics.getTopicFields(tid, ['tid', 'cid', 'uid', 'deleted', 'title', 'mainPid'], next);
			},
			(_topicData, next) => {
				topicData = _topicData;

				if (parseInt(topicData.deleted, 10) === 1 && isDelete) {
					return callback(new Error('[[error:topic-already-deleted]]'));
				} else if (parseInt(topicData.deleted, 10) !== 1 && !isDelete) {
					return callback(new Error('[[error:topic-already-restored]]'));
				}

				Topics[isDelete ? 'delete' : 'restore'](tid, uid, next);
			},
			(next) => {
				categories.updateRecentTidForCid(topicData.cid, next);
			},
			(next) => {
				topicData.deleted = isDelete ? 1 : 0;

				if (isDelete) {
					plugins.fireHook('action:topic.delete', { topic: topicData, uid: uid });
				} else {
					plugins.fireHook('action:topic.restore', { topic: topicData, uid: uid });
				}

				var data = {
					tid: tid,
					cid: topicData.cid,
					isDelete: isDelete,
					uid: uid,
				};

				next(null, data);
			},
		], callback);
	}

	topicTools.purge = (tid, uid, callback) => {
		var cid;
		async.waterfall([
			(next) => {
				Topics.exists(tid, next);
			},
			(exists, next) => {
				if (!exists) {
					return callback();
				}
				privileges.topics.canPurge(tid, uid, next);
			},
			(canPurge, next) => {
				if (!canPurge) {
					return next(new Error('[[error:no-privileges]]'));
				}

				Topics.getTopicField(tid, 'cid', next);
			},
			(_cid, next) => {
				cid = _cid;

				Topics.purgePostsAndTopic(tid, uid, next);
			},
			(next) => {
				next(null, { tid: tid, cid: cid, uid: uid });
			},
		], callback);
	};

	topicTools.lock = (tid, uid, callback) => {
		toggleLock(tid, uid, true, callback);
	};

	topicTools.unlock = (tid, uid, callback) => {
		toggleLock(tid, uid, false, callback);
	};

	function toggleLock(tid, uid, lock, callback) {
		callback = callback || function () {};

		var topicData;

		async.waterfall([
			(next) => {
				Topics.getTopicFields(tid, ['tid', 'uid', 'cid'], next);
			},
			(_topicData, next) => {
				topicData = _topicData;
				if (!topicData || !topicData.cid) {
					return next(new Error('[[error:no-topic]]'));
				}
				privileges.categories.isAdminOrMod(topicData.cid, uid, next);
			},
			(isAdminOrMod, next) => {
				if (!isAdminOrMod) {
					return next(new Error('[[error:no-privileges]]'));
				}

				Topics.setTopicField(tid, 'locked', lock ? 1 : 0, next);
			},
			(next) => {
				topicData.isLocked = lock;

				plugins.fireHook('action:topic.lock', { topic: _.clone(topicData), uid: uid });

				next(null, topicData);
			},
		], callback);
	}

	topicTools.pin = (tid, uid, callback) => {
		togglePin(tid, uid, true, callback);
	};

	topicTools.unpin = (tid, uid, callback) => {
		togglePin(tid, uid, false, callback);
	};

	function togglePin(tid, uid, pin, callback) {
		var topicData;
		async.waterfall([
			(next) => {
				Topics.getTopicData(tid, next);
			},
			(_topicData, next) => {
				topicData = _topicData;
				if (!topicData) {
					return callback(new Error('[[error:no-topic]]'));
				}
				privileges.categories.isAdminOrMod(_topicData.cid, uid, next);
			},
			(isAdminOrMod, next) => {
				if (!isAdminOrMod) {
					return next(new Error('[[error:no-privileges]]'));
				}

				async.parallel([
					async.apply(Topics.setTopicField, tid, 'pinned', pin ? 1 : 0),
					(next) => {
						if (pin) {
							async.parallel([
								async.apply(db.sortedSetAdd, 'cid:' + topicData.cid + ':tids:pinned', Date.now(), tid),
								async.apply(db.sortedSetRemove, 'cid:' + topicData.cid + ':tids', tid),
								async.apply(db.sortedSetRemove, 'cid:' + topicData.cid + ':tids:posts', tid),
								async.apply(db.sortedSetRemove, 'cid:' + topicData.cid + ':tids:votes', tid),
							], next);
						} else {
							var votes = (parseInt(topicData.upvotes, 10) || 0) - (parseInt(topicData.downvotes, 10) || 0);
							async.parallel([
								async.apply(db.sortedSetRemove, 'cid:' + topicData.cid + ':tids:pinned', tid),
								async.apply(db.sortedSetAdd, 'cid:' + topicData.cid + ':tids', topicData.lastposttime, tid),
								async.apply(db.sortedSetAdd, 'cid:' + topicData.cid + ':tids:posts', topicData.postcount, tid),
								async.apply(db.sortedSetAdd, 'cid:' + topicData.cid + ':tids:votes', votes, tid),
							], next);
						}
					},
				], next);
			},
			(results, next) => {
				topicData.isPinned = pin;

				plugins.fireHook('action:topic.pin', { topic: _.clone(topicData), uid: uid });

				next(null, topicData);
			},
		], callback);
	}

	topicTools.orderPinnedTopics = (uid, data, callback) => {
		var cid;
		async.waterfall([
			(next) => {
				var tids = data.map(topic => topic && topic.tid);
				Topics.getTopicsFields(tids, ['cid'], next);
			},
			(topicData, next) => {
				var uniqueCids = _.uniq(topicData.map(topicData => topicData && parseInt(topicData.cid, 10)));

				if (uniqueCids.length > 1 || !uniqueCids.length || !uniqueCids[0]) {
					return next(new Error('[[error:invalid-data]]'));
				}
				cid = uniqueCids[0];

				privileges.categories.isAdminOrMod(cid, uid, next);
			},
			(isAdminOrMod, next) => {
				if (!isAdminOrMod) {
					return next(new Error('[[error:no-privileges]]'));
				}
				async.eachSeries(data, (topicData, next) => {
					async.waterfall([
						(next) => {
							db.isSortedSetMember('cid:' + cid + ':tids:pinned', topicData.tid, next);
						},
						(isPinned, next) => {
							if (isPinned) {
								db.sortedSetAdd('cid:' + cid + ':tids:pinned', topicData.order, topicData.tid, next);
							} else {
								setImmediate(next);
							}
						},
					], next);
				}, next);
			},
		], callback);
	};

	topicTools.move = (tid, data, callback) => {
		var topic;
		var oldCid;
		var cid = data.cid;

		async.waterfall([
			(next) => {
				Topics.getTopicData(tid, next);
			},
			(topicData, next) => {
				topic = topicData;
				if (!topic) {
					return next(new Error('[[error:no-topic]]'));
				}
				if (parseInt(cid, 10) === parseInt(topic.cid, 10)) {
					return next(new Error('[[error:cant-move-topic-to-same-category]]'));
				}
				db.sortedSetsRemove([
					'cid:' + topicData.cid + ':tids',
					'cid:' + topicData.cid + ':tids:pinned',
					'cid:' + topicData.cid + ':tids:posts',
					'cid:' + topicData.cid + ':tids:votes',
					'cid:' + topicData.cid + ':tids:lastposttime',
					'cid:' + topicData.cid + ':recent_tids',
					'cid:' + topicData.cid + ':uid:' + topicData.uid + ':tids',
				], tid, next);
			},
			(next) => {
				db.sortedSetAdd('cid:' + cid + ':tids:lastposttime', topic.lastposttime, tid, next);
			},
			(next) => {
				db.sortedSetAdd('cid:' + cid + ':uid:' + topic.uid + ':tids', topic.timestamp, tid, next);
			},
			(next) => {
				if (parseInt(topic.pinned, 10)) {
					db.sortedSetAdd('cid:' + cid + ':tids:pinned', Date.now(), tid, next);
				} else {
					async.parallel([
						(next) => {
							db.sortedSetAdd('cid:' + cid + ':tids', topic.lastposttime, tid, next);
						},
						(next) => {
							topic.postcount = topic.postcount || 0;
							db.sortedSetAdd('cid:' + cid + ':tids:posts', topic.postcount, tid, next);
						},
						(next) => {
							var votes = (parseInt(topic.upvotes, 10) || 0) - (parseInt(topic.downvotes, 10) || 0);
							db.sortedSetAdd('cid:' + cid + ':tids:votes', votes, tid, next);
						},
					], (err) => {
						next(err);
					});
				}
			},
			(next) => {
				oldCid = topic.cid;
				categories.moveRecentReplies(tid, oldCid, cid, next);
			},
			(next) => {
				async.parallel([
					(next) => {
						categories.incrementCategoryFieldBy(oldCid, 'topic_count', -1, next);
					},
					(next) => {
						categories.incrementCategoryFieldBy(cid, 'topic_count', 1, next);
					},
					(next) => {
						categories.updateRecentTid(cid, tid, next);
					},
					(next) => {
						categories.updateRecentTidForCid(oldCid, next);
					},
					(next) => {
						Topics.setTopicFields(tid, {
							cid: cid,
							oldCid: oldCid,
						}, next);
					},
				], (err) => {
					next(err);
				});
			},
			(next) => {
				var hookData = _.clone(data);
				hookData.fromCid = oldCid;
				hookData.toCid = cid;
				hookData.tid = tid;
				plugins.fireHook('action:topic.move', hookData);
				next();
			},
		], callback);
	};
};
