var async = require('async');
var _ = require('lodash');

var db = require('../database');
var topics = require('../topics');
var user = require('../user');
var groups = require('../groups');
var notifications = require('../notifications');
var plugins = require('../plugins');

module.exports = (Posts) => {
	Posts.delete = (pid, uid, callback) => {
		var postData;
		async.waterfall([
			(next) => {
				plugins.fireHook('filter:post.delete', { pid: pid, uid: uid }, next);
			},
			(data, next) => {
				Posts.setPostFields(pid, { deleted: 1, deleterUid: uid }, next);
			},
			(next) => {
				Posts.getPostFields(pid, ['pid', 'tid', 'uid', 'timestamp'], next);
			},
			(_post, next) => {
				postData = _post;
				topics.getTopicFields(_post.tid, ['tid', 'cid', 'pinned'], next);
			},
			(topicData, next) => {
				postData.cid = topicData.cid;
				async.parallel([
					(next) => {
						updateTopicTimestamp(topicData, next);
					},
					(next) => {
						db.sortedSetRemove('cid:' + topicData.cid + ':pids', pid, next);
					},
					(next) => {
						topics.updateTeaser(postData.tid, next);
					},
				], next);
			},
			(results, next) => {
				plugins.fireHook('action:post.delete', { post: _.clone(postData), uid: uid });
				next(null, postData);
			},
		], callback);
	};

	Posts.restore = (pid, uid, callback) => {
		var postData;
		async.waterfall([
			(next) => {
				plugins.fireHook('filter:post.restore', { pid: pid, uid: uid }, next);
			},
			(data, next) => {
				Posts.setPostFields(pid, { deleted: 0, deleterUid: 0 }, next);
			},
			(next) => {
				Posts.getPostFields(pid, ['pid', 'tid', 'uid', 'content', 'timestamp'], next);
			},
			(_post, next) => {
				postData = _post;
				topics.getTopicFields(_post.tid, ['tid', 'cid', 'pinned'], next);
			},
			(topicData, next) => {
				postData.cid = topicData.cid;
				async.parallel([
					(next) => {
						updateTopicTimestamp(topicData, next);
					},
					(next) => {
						db.sortedSetAdd('cid:' + topicData.cid + ':pids', postData.timestamp, pid, next);
					},
					(next) => {
						topics.updateTeaser(postData.tid, next);
					},
				], next);
			},
			(results, next) => {
				plugins.fireHook('action:post.restore', { post: _.clone(postData), uid: uid });
				next(null, postData);
			},
		], callback);
	};

	function updateTopicTimestamp(topicData, callback) {
		var timestamp;
		async.waterfall([
			(next) => {
				topics.getLatestUndeletedPid(topicData.tid, next);
			},
			(pid, next) => {
				if (!parseInt(pid, 10)) {
					return callback();
				}
				Posts.getPostField(pid, 'timestamp', next);
			},
			(_timestamp, next) => {
				timestamp = _timestamp;
				if (!parseInt(timestamp, 10)) {
					return callback();
				}
				topics.updateTimestamp(topicData.tid, timestamp, next);
			},
			(next) => {
				if (parseInt(topicData.pinned, 10) !== 1) {
					db.sortedSetAdd('cid:' + topicData.cid + ':tids', timestamp, topicData.tid, next);
				} else {
					next();
				}
			},
		], callback);
	}

	Posts.purge = (pid, uid, callback) => {
		async.waterfall([
			(next) => {
				Posts.exists(pid, next);
			},
			(exists, next) => {
				if (!exists) {
					return callback();
				}
				plugins.fireHook('filter:post.purge', { pid: pid, uid: uid }, next);
			},
			(data, next) => {
				async.parallel([
					(next) => {
						deletePostFromTopicUserNotification(pid, next);
					},
					(next) => {
						deletePostFromCategoryRecentPosts(pid, next);
					},
					(next) => {
						deletePostFromUsersBookmarks(pid, next);
					},
					(next) => {
						deletePostFromUsersVotes(pid, next);
					},
					(next) => {
						deletePostFromReplies(pid, next);
					},
					(next) => {
						deletePostFromGroups(pid, next);
					},
					(next) => {
						db.sortedSetsRemove(['posts:pid', 'posts:votes', 'posts:flagged'], pid, next);
					},
				], (err) => {
					next(err);
				});
			},
			(next) => {
				Posts.getPostData(pid, next);
			},
			(postData, next) => {
				plugins.fireHook('action:post.purge', { post: postData, uid: uid });
				db.delete('post:' + pid, next);
			},
		], callback);
	};

	function deletePostFromTopicUserNotification(pid, callback) {
		var postData;
		async.waterfall([
			(next) => {
				Posts.getPostFields(pid, ['tid', 'uid'], next);
			},
			(_postData, next) => {
				postData = _postData;
				db.sortedSetsRemove([
					'tid:' + postData.tid + ':posts',
					'tid:' + postData.tid + ':posts:votes',
					'uid:' + postData.uid + ':posts',
				], pid, next);
			},
			(next) => {
				topics.getTopicFields(postData.tid, ['tid', 'cid', 'pinned'], next);
			},
			(topicData, next) => {
				async.parallel([
					(next) => {
						db.decrObjectField('global', 'postCount', next);
					},
					(next) => {
						db.decrObjectField('category:' + topicData.cid, 'post_count', next);
					},
					(next) => {
						topics.decreasePostCount(postData.tid, next);
					},
					(next) => {
						topics.updateTeaser(postData.tid, next);
					},
					(next) => {
						updateTopicTimestamp(topicData, next);
					},
					(next) => {
						db.sortedSetIncrBy('cid:' + topicData.cid + ':tids:posts', -1, postData.tid, next);
					},
					(next) => {
						db.sortedSetIncrBy('tid:' + postData.tid + ':posters', -1, postData.uid, next);
					},
					(next) => {
						user.incrementUserPostCountBy(postData.uid, -1, next);
					},
					(next) => {
						notifications.rescind('new_post:tid:' + postData.tid + ':pid:' + pid + ':uid:' + postData.uid, next);
					},
				], next);
			},
		], (err) => {
			callback(err);
		});
	}

	function deletePostFromCategoryRecentPosts(pid, callback) {
		async.waterfall([
			(next) => {
				db.getSortedSetRange('categories:cid', 0, -1, next);
			},
			(cids, next) => {
				var sets = cids.map(cid => 'cid:' + cid + ':pids');

				db.sortedSetsRemove(sets, pid, next);
			},
		], callback);
	}

	function deletePostFromUsersBookmarks(pid, callback) {
		async.waterfall([
			(next) => {
				db.getSetMembers('pid:' + pid + ':users_bookmarked', next);
			},
			(uids, next) => {
				var sets = uids.map(uid => 'uid:' + uid + ':bookmarks');

				db.sortedSetsRemove(sets, pid, next);
			},
			(next) => {
				db.delete('pid:' + pid + ':users_bookmarked', next);
			},
		], callback);
	}

	function deletePostFromUsersVotes(pid, callback) {
		async.waterfall([
			(next) => {
				async.parallel({
					upvoters: (next) => {
						db.getSetMembers('pid:' + pid + ':upvote', next);
					},
					downvoters: (next) => {
						db.getSetMembers('pid:' + pid + ':downvote', next);
					},
				}, next);
			},
			(results, next) => {
				var upvoterSets = results.upvoters.map(uid => 'uid:' + uid + ':upvote');

				var downvoterSets = results.downvoters.map(uid => 'uid:' + uid + ':downvote');

				async.parallel([
					(next) => {
						db.sortedSetsRemove(upvoterSets, pid, next);
					},
					(next) => {
						db.sortedSetsRemove(downvoterSets, pid, next);
					},
					(next) => {
						db.deleteAll(['pid:' + pid + ':upvote', 'pid:' + pid + ':downvote'], next);
					},
				], next);
			},
		], callback);
	}

	function deletePostFromReplies(pid, callback) {
		async.waterfall([
			(next) => {
				Posts.getPostField(pid, 'toPid', next);
			},
			(toPid, next) => {
				if (!parseInt(toPid, 10)) {
					return callback(null);
				}
				async.parallel([
					async.apply(db.sortedSetRemove, 'pid:' + toPid + ':replies', pid),
					async.apply(db.decrObjectField, 'post:' + toPid, 'replies'),
				], next);
			},
		], callback);
	}

	function deletePostFromGroups(pid, callback) {
		async.waterfall([
			(next) => {
				Posts.getPostField(pid, 'uid', next);
			},
			(uid, next) => {
				if (!parseInt(uid, 10)) {
					return callback();
				}
				groups.getUserGroupMembership('groups:visible:createtime', [uid], next);
			},
			(groupNames, next) => {
				groupNames = groupNames[0];
				var keys = groupNames.map(groupName => 'group:' + groupName + ':member:pids');

				db.sortedSetsRemove(keys, pid, next);
			},
		], callback);
	}
};
