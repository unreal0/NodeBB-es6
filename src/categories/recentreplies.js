

var async = require('async');
var _ = require('lodash');

var db = require('../database');
var posts = require('../posts');
var topics = require('../topics');
var privileges = require('../privileges');
var batch = require('../batch');

module.exports = (Categories) => {
	Categories.getRecentReplies = (cid, uid, count, callback) => {
		if (!parseInt(count, 10)) {
			return callback(null, []);
		}

		async.waterfall([
			(next) => {
				db.getSortedSetRevRange('cid:' + cid + ':pids', 0, count - 1, next);
			},
			(pids, next) => {
				privileges.posts.filter('read', pids, uid, next);
			},
			(pids, next) => {
				posts.getPostSummaryByPids(pids, uid, { stripTags: true }, next);
			},
		], callback);
	};

	Categories.updateRecentTid = (cid, tid, callback) => {
		async.waterfall([
			(next) => {
				async.parallel({
					count: (next) => {
						db.sortedSetCard('cid:' + cid + ':recent_tids', next);
					},
					numRecentReplies: (next) => {
						db.getObjectField('category:' + cid, 'numRecentReplies', next);
					},
				}, next);
			},
			(results, next) => {
				if (results.count < results.numRecentReplies) {
					return db.sortedSetAdd('cid:' + cid + ':recent_tids', Date.now(), tid, callback);
				}
				db.getSortedSetRangeWithScores('cid:' + cid + ':recent_tids', 0, results.count - results.numRecentReplies, next);
			},
			(data, next) => {
				if (!data.length) {
					return next();
				}
				db.sortedSetsRemoveRangeByScore(['cid:' + cid + ':recent_tids'], '-inf', data[data.length - 1].score, next);
			},
			(next) => {
				db.sortedSetAdd('cid:' + cid + ':recent_tids', Date.now(), tid, next);
			},
		], callback);
	};

	Categories.updateRecentTidForCid = (cid, callback) => {
		async.waterfall([
			(next) => {
				db.getSortedSetRevRange('cid:' + cid + ':pids', 0, 0, next);
			},
			(pid, next) => {
				pid = pid[0];
				posts.getPostField(pid, 'tid', next);
			},
			(tid, next) => {
				if (!parseInt(tid, 10)) {
					return next();
				}

				Categories.updateRecentTid(cid, tid, next);
			},
		], callback);
	};

	Categories.getRecentTopicReplies = (categoryData, uid, callback) => {
		if (!Array.isArray(categoryData) || !categoryData.length) {
			return callback();
		}

		async.waterfall([
			(next) => {
				var keys = categoryData.map(category => 'cid:' + category.cid + ':recent_tids');
				db.getSortedSetsMembers(keys, next);
			},
			(results, next) => {
				var tids = _.uniq(_.flatten(results).filter(Boolean));

				privileges.topics.filterTids('read', tids, uid, next);
			},
			(tids, next) => {
				getTopics(tids, uid, next);
			},
			(topics, next) => {
				assignTopicsToCategories(categoryData, topics);

				bubbleUpChildrenPosts(categoryData);

				next();
			},
		], callback);
	};

	function getTopics(tids, uid, callback) {
		var topicData;
		async.waterfall([
			(next) => {
				topics.getTopicsFields(tids, ['tid', 'mainPid', 'slug', 'title', 'teaserPid', 'cid', 'postcount'], next);
			},
			(_topicData, next) => {
				topicData = _topicData;
				topicData.forEach((topic) => {
					if (topic) {
						topic.teaserPid = topic.teaserPid || topic.mainPid;
					}
				});
				var cids = _topicData.map(topic => topic && topic.cid).filter((cid, index, array) => cid && array.indexOf(cid) === index);

				async.parallel({
					categoryData: async.apply(Categories.getCategoriesFields, cids, ['cid', 'parentCid']),
					teasers: async.apply(topics.getTeasers, _topicData, uid),
				}, next);
			},
			(results, next) => {
				var parentCids = {};
				results.categoryData.forEach((category) => {
					parentCids[category.cid] = category.parentCid;
				});
				results.teasers.forEach((teaser, index) => {
					if (teaser) {
						teaser.cid = topicData[index].cid;
						teaser.parentCid = parseInt(parentCids[teaser.cid], 10) || 0;
						teaser.tid = undefined;
						teaser.uid = undefined;
						teaser.user.uid = undefined;
						teaser.topic = {
							slug: topicData[index].slug,
							title: topicData[index].title,
						};
					}
				});
				results.teasers = results.teasers.filter(Boolean);
				next(null, results.teasers);
			},
		], callback);
	}

	function assignTopicsToCategories(categories, topics) {
		categories.forEach((category) => {
			category.posts = topics.filter(topic => topic.cid && (parseInt(topic.cid, 10) === parseInt(category.cid, 10) ||
					parseInt(topic.parentCid, 10) === parseInt(category.cid, 10))).sort((a, b) => b.pid - a.pid).slice(0, parseInt(category.numRecentReplies, 10));
		});
	}

	function bubbleUpChildrenPosts(categoryData) {
		categoryData.forEach((category) => {
			if (category.posts.length) {
				return;
			}
			var posts = [];
			getPostsRecursive(category, posts);

			posts.sort((a, b) => b.pid - a.pid);
			if (posts.length) {
				category.posts = [posts[0]];
			}
		});
	}

	function getPostsRecursive(category, posts) {
		category.posts.forEach((p) => {
			posts.push(p);
		});

		category.children.forEach((child) => {
			getPostsRecursive(child, posts);
		});
	}

	Categories.moveRecentReplies = (tid, oldCid, cid, callback) => {
		callback = callback || function () {};

		async.waterfall([
			(next) => {
				updatePostCount(tid, oldCid, cid, next);
			},
			(next) => {
				topics.getPids(tid, next);
			},
			(pids, next) => {
				batch.processArray(pids, (pids, next) => {
					async.waterfall([
						(next) => {
							posts.getPostsFields(pids, ['timestamp'], next);
						},
						(postData, next) => {
							var timestamps = postData.map(post => post && post.timestamp);

							async.parallel([
								(next) => {
									db.sortedSetRemove('cid:' + oldCid + ':pids', pids, next);
								},
								(next) => {
									db.sortedSetAdd('cid:' + cid + ':pids', timestamps, pids, next);
								},
							], next);
						},
					], next);
				}, next);
			},
		], callback);
	};

	function updatePostCount(tid, oldCid, newCid, callback) {
		async.waterfall([
			(next) => {
				topics.getTopicField(tid, 'postcount', next);
			},
			(postCount, next) => {
				if (!parseInt(postCount, 10)) {
					return callback();
				}
				async.parallel([
					(next) => {
						db.incrObjectFieldBy('category:' + oldCid, 'post_count', -postCount, next);
					},
					(next) => {
						db.incrObjectFieldBy('category:' + newCid, 'post_count', postCount, next);
					},
				], (err) => {
					next(err);
				});
			},
		], callback);
	}
};

