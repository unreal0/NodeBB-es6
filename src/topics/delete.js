var async = require('async');
var db = require('../database');

var user = require('../user');
var posts = require('../posts');
var plugins = require('../plugins');
var batch = require('../batch');


module.exports = (Topics) => {
	Topics.delete = (tid, uid, callback) => {
		async.parallel([
			(next) => {
				Topics.setTopicFields(tid, {
					deleted: 1,
					deleterUid: uid,
					deletedTimestamp: Date.now(),
				}, next);
			},
			(next) => {
				db.sortedSetsRemove([
					'topics:recent',
					'topics:posts',
					'topics:views',
					'topics:votes',
				], tid, next);
			},
			(next) => {
				async.waterfall([
					(next) => {
						async.parallel({
							cid: (next) => {
								Topics.getTopicField(tid, 'cid', next);
							},
							pids: (next) => {
								Topics.getPids(tid, next);
							},
						}, next);
					},
					(results, next) => {
						db.sortedSetRemove('cid:' + results.cid + ':pids', results.pids, next);
					},
				], next);
			},
		], (err) => {
			callback(err);
		});
	};

	Topics.restore = (tid, uid, callback) => {
		var topicData;
		async.waterfall([
			(next) => {
				Topics.getTopicData(tid, next);
			},
			(_topicData, next) => {
				topicData = _topicData;
				async.parallel([
					(next) => {
						Topics.setTopicField(tid, 'deleted', 0, next);
					},
					(next) => {
						Topics.deleteTopicFields(tid, ['deleterUid', 'deletedTimestamp'], next);
					},
					(next) => {
						Topics.updateRecent(tid, topicData.lastposttime, next);
					},
					(next) => {
						db.sortedSetAdd('topics:posts', topicData.postcount, tid, next);
					},
					(next) => {
						db.sortedSetAdd('topics:views', topicData.viewcount, tid, next);
					},
					(next) => {
						var upvotes = parseInt(topicData.upvotes, 10) || 0;
						var downvotes = parseInt(topicData.downvotes, 10) || 0;
						db.sortedSetAdd('topics:votes', upvotes - downvotes, tid, next);
					},
					(next) => {
						async.waterfall([
							(next) => {
								Topics.getPids(tid, next);
							},
							(pids, next) => {
								posts.getPostsFields(pids, ['pid', 'timestamp', 'deleted'], next);
							},
							(postData, next) => {
								postData = postData.filter(post => post && parseInt(post.deleted, 10) !== 1);
								var pidsToAdd = [];
								var scores = [];
								postData.forEach((post) => {
									pidsToAdd.push(post.pid);
									scores.push(post.timestamp);
								});
								db.sortedSetAdd('cid:' + topicData.cid + ':pids', scores, pidsToAdd, next);
							},
						], next);
					},
				], (err) => {
					next(err);
				});
			},
		], callback);
	};

	Topics.purgePostsAndTopic = (tid, uid, callback) => {
		var mainPid;
		async.waterfall([
			(next) => {
				Topics.getTopicField(tid, 'mainPid', next);
			},
			(_mainPid, next) => {
				mainPid = _mainPid;
				batch.processSortedSet('tid:' + tid + ':posts', (pids, next) => {
					async.eachLimit(pids, 10, (pid, next) => {
						posts.purge(pid, uid, next);
					}, next);
				}, { alwaysStartAt: 0 }, next);
			},
			(next) => {
				posts.purge(mainPid, uid, next);
			},
			(next) => {
				Topics.purge(tid, uid, next);
			},
		], callback);
	};

	Topics.purge = (tid, uid, callback) => {
		async.waterfall([
			(next) => {
				deleteFromFollowersIgnorers(tid, next);
			},
			(next) => {
				async.parallel([
					(next) => {
						db.deleteAll([
							'tid:' + tid + ':followers',
							'tid:' + tid + ':ignorers',
							'tid:' + tid + ':posts',
							'tid:' + tid + ':posts:votes',
							'tid:' + tid + ':bookmarks',
							'tid:' + tid + ':posters',
						], next);
					},
					(next) => {
						db.sortedSetsRemove([
							'topics:tid',
							'topics:recent',
							'topics:posts',
							'topics:views',
							'topics:votes',
						], tid, next);
					},
					(next) => {
						deleteTopicFromCategoryAndUser(tid, next);
					},
					(next) => {
						Topics.deleteTopicTags(tid, next);
					},
					(next) => {
						reduceCounters(tid, next);
					},
				], (err) => {
					next(err);
				});
			},
			(next) => {
				Topics.getTopicData(tid, next);
			},
			(topicData, next) => {
				plugins.fireHook('action:topic.purge', { topic: topicData, uid: uid });
				db.delete('topic:' + tid, next);
			},
		], callback);
	};

	function deleteFromFollowersIgnorers(tid, callback) {
		async.waterfall([
			(next) => {
				async.parallel({
					followers: async.apply(db.getSetMembers, 'tid:' + tid + ':followers'),
					ignorers: async.apply(db.getSetMembers, 'tid:' + tid + ':ignorers'),
				}, next);
			},
			(results, next) => {
				var followerKeys = results.followers.map(uid => 'uid:' + uid + ':followed_tids');
				var ignorerKeys = results.ignorers.map(uid => 'uid:' + uid + 'ignored_tids');
				db.sortedSetsRemove(followerKeys.concat(ignorerKeys), tid, next);
			},
		], callback);
	}

	function deleteTopicFromCategoryAndUser(tid, callback) {
		async.waterfall([
			(next) => {
				Topics.getTopicFields(tid, ['cid', 'uid'], next);
			},
			(topicData, next) => {
				async.parallel([
					(next) => {
						db.sortedSetsRemove([
							'cid:' + topicData.cid + ':tids',
							'cid:' + topicData.cid + ':tids:pinned',
							'cid:' + topicData.cid + ':tids:posts',
							'cid:' + topicData.cid + ':tids:lastposttime',
							'cid:' + topicData.cid + ':tids:votes',
							'cid:' + topicData.cid + ':recent_tids',
							'cid:' + topicData.cid + ':uid:' + topicData.uid + ':tids',
							'uid:' + topicData.uid + ':topics',
						], tid, next);
					},
					(next) => {
						user.decrementUserFieldBy(topicData.uid, 'topiccount', 1, next);
					},
				], next);
			},
		], (err) => {
			callback(err);
		});
	}

	function reduceCounters(tid, callback) {
		var incr = -1;
		async.parallel([
			(next) => {
				db.incrObjectFieldBy('global', 'topicCount', incr, next);
			},
			(next) => {
				async.waterfall([
					(next) => {
						Topics.getTopicFields(tid, ['cid', 'postcount'], next);
					},
					(topicData, next) => {
						topicData.postcount = parseInt(topicData.postcount, 10);
						topicData.postcount = topicData.postcount || 0;
						var postCountChange = incr * topicData.postcount;

						async.parallel([
							(next) => {
								db.incrObjectFieldBy('global', 'postCount', postCountChange, next);
							},
							(next) => {
								db.incrObjectFieldBy('category:' + topicData.cid, 'post_count', postCountChange, next);
							},
							(next) => {
								db.incrObjectFieldBy('category:' + topicData.cid, 'topic_count', incr, next);
							},
						], next);
					},
				], next);
			},
		], callback);
	}
};
