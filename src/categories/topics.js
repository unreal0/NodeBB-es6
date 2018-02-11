var async = require('async');
var _ = require('lodash');

var db = require('../database');
var topics = require('../topics');
var plugins = require('../plugins');
var meta = require('../meta');

module.exports = (Categories) => {
	Categories.getCategoryTopics = (data, callback) => {
		async.waterfall([
			(next) => {
				plugins.fireHook('filter:category.topics.prepare', data, next);
			},
			(data, next) => {
				Categories.getTopicIds(data, next);
			},
			(tids, next) => {
				topics.getTopicsByTids(tids, data.uid, next);
			},
			(topics, next) => {
				if (!topics.length) {
					return next(null, { topics: [], uid: data.uid });
				}

				for (var i = 0; i < topics.length; i += 1) {
					topics[i].index = data.start + i;
				}

				plugins.fireHook('filter:category.topics.get', { cid: data.cid, topics: topics, uid: data.uid }, next);
			},
			(results, next) => {
				next(null, { topics: results.topics, nextStart: data.stop + 1 });
			},
		], callback);
	};

	Categories.getTopicIds = (data, callback) => {
		var pinnedTids;

		async.waterfall([
			(next) => {
				var dataForPinned = _.cloneDeep(data);
				dataForPinned.start = 0;
				dataForPinned.stop = -1;

				async.parallel({
					pinnedTids: async.apply(Categories.getPinnedTids, dataForPinned),
					set: async.apply(Categories.buildTopicsSortedSet, data),
					direction: async.apply(Categories.getSortedSetRangeDirection, data.sort),
				}, next);
			},
			(results, next) => {
				var totalPinnedCount = results.pinnedTids.length;

				pinnedTids = results.pinnedTids.slice(data.start, data.stop === -1 ? undefined : data.stop + 1);

				var pinnedCount = pinnedTids.length;

				var topicsPerPage = data.stop - data.start + 1;

				var normalTidsToGet = Math.max(0, topicsPerPage - pinnedCount);

				if (!normalTidsToGet && data.stop !== -1) {
					return next(null, []);
				}

				if (plugins.hasListeners('filter:categories.getTopicIds')) {
					return plugins.fireHook('filter:categories.getTopicIds', {
						tids: [],
						data: data,
						pinnedTids: pinnedTids,
						allPinnedTids: results.pinnedTids,
						totalPinnedCount: totalPinnedCount,
						normalTidsToGet: normalTidsToGet,
					}, (err, data) => {
						callback(err, data && data.tids);
					});
				}

				var set = results.set;
				var direction = results.direction;
				var start = data.start;
				if (start > 0 && totalPinnedCount) {
					start -= totalPinnedCount - pinnedCount;
				}

				var stop = data.stop === -1 ? data.stop : start + normalTidsToGet - 1;

				if (Array.isArray(set)) {
					var weights = set.map((s, index) => (index ? 0 : 1));
					db[direction === 'highest-to-lowest' ? 'getSortedSetRevIntersect' : 'getSortedSetIntersect']({ sets: set, start: start, stop: stop, weights: weights }, next);
				} else {
					db[direction === 'highest-to-lowest' ? 'getSortedSetRevRange' : 'getSortedSetRange'](set, start, stop, next);
				}
			},
			(normalTids, next) => {
				normalTids = normalTids.filter(tid => pinnedTids.indexOf(tid) === -1);

				next(null, pinnedTids.concat(normalTids));
			},
		], callback);
	};

	Categories.getTopicCount = (data, callback) => {
		if (plugins.hasListeners('filter:categories.getTopicCount')) {
			return plugins.fireHook('filter:categories.getTopicCount', {
				topicCount: data.category.topic_count,
				data: data,
			}, (err, data) => {
				callback(err, data && data.topicCount);
			});
		}
		async.waterfall([
			(next) => {
				Categories.buildTopicsSortedSet(data, next);
			},
			(set, next) => {
				if (Array.isArray(set)) {
					db.sortedSetIntersectCard(set, next);
				} else {
					next(null, data.category.topic_count);
				}
			},
		], callback);
	};

	Categories.buildTopicsSortedSet = (data, callback) => {
		var cid = data.cid;
		var set = 'cid:' + cid + ':tids';
		var sort = data.sort || (data.settings && data.settings.categoryTopicSort) || meta.config.categoryTopicSort || 'newest_to_oldest';

		if (sort === 'most_posts') {
			set = 'cid:' + cid + ':tids:posts';
		} else if (sort === 'most_votes') {
			set = 'cid:' + cid + ':tids:votes';
		}

		if (data.targetUid) {
			set = 'cid:' + cid + ':uid:' + data.targetUid + ':tids';
		}

		if (data.tag) {
			if (Array.isArray(data.tag)) {
				set = [set].concat(data.tag.map(tag => 'tag:' + tag + ':topics'));
			} else {
				set = [set, 'tag:' + data.tag + ':topics'];
			}
		}
		plugins.fireHook('filter:categories.buildTopicsSortedSet', {
			set: set,
			data: data,
		}, (err, data) => {
			callback(err, data && data.set);
		});
	};

	Categories.getSortedSetRangeDirection = (sort, callback) => {
		sort = sort || 'newest_to_oldest';
		var direction = sort === 'newest_to_oldest' || sort === 'most_posts' || sort === 'most_votes' ? 'highest-to-lowest' : 'lowest-to-highest';
		plugins.fireHook('filter:categories.getSortedSetRangeDirection', {
			sort: sort,
			direction: direction,
		}, (err, data) => {
			callback(err, data && data.direction);
		});
	};

	Categories.getAllTopicIds = (cid, start, stop, callback) => {
		db.getSortedSetRange(['cid:' + cid + ':tids:pinned', 'cid:' + cid + ':tids'], start, stop, callback);
	};

	Categories.getPinnedTids = (data, callback) => {
		if (plugins.hasListeners('filter:categories.getPinnedTids')) {
			return plugins.fireHook('filter:categories.getPinnedTids', {
				pinnedTids: [],
				data: data,
			}, (err, data) => {
				callback(err, data && data.pinnedTids);
			});
		}

		db.getSortedSetRevRange('cid:' + data.cid + ':tids:pinned', data.start, data.stop, callback);
	};

	Categories.modifyTopicsByPrivilege = (topics, privileges) => {
		if (!Array.isArray(topics) || !topics.length || privileges.isAdminOrMod) {
			return;
		}

		topics.forEach((topic) => {
			if (topic.deleted && !topic.isOwner) {
				topic.title = '[[topic:topic_is_deleted]]';
				topic.slug = topic.tid;
				topic.teaser = null;
				topic.noAnchor = true;
				topic.tags = [];
			}
		});
	};

	Categories.getTopicIndex = (tid, callback) => {
		console.warn('[Categories.getTopicIndex] deprecated');
		callback(null, 1);
	};

	Categories.onNewPostMade = (cid, pinned, postData, callback) => {
		if (!cid || !postData) {
			return setImmediate(callback);
		}

		async.parallel([
			(next) => {
				db.sortedSetAdd('cid:' + cid + ':pids', postData.timestamp, postData.pid, next);
			},
			(next) => {
				db.sortedSetAdd('cid:' + cid + ':tids:lastposttime', postData.timestamp, postData.tid, next);
			},
			(next) => {
				db.incrObjectField('category:' + cid, 'post_count', next);
			},
			(next) => {
				if (parseInt(pinned, 10) === 1) {
					return setImmediate(next);
				}

				async.parallel([
					(next) => {
						db.sortedSetAdd('cid:' + cid + ':tids', postData.timestamp, postData.tid, next);
					},
					(next) => {
						db.sortedSetIncrBy('cid:' + cid + ':tids:posts', 1, postData.tid, next);
					},
				], (err) => {
					next(err);
				});
			},
			(next) => {
				Categories.updateRecentTid(cid, postData.tid, next);
			},
		], callback);
	};
};
