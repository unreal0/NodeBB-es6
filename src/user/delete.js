var async = require('async');
var _ = require('lodash');

var db = require('../database');
var posts = require('../posts');
var topics = require('../topics');
var groups = require('../groups');
var plugins = require('../plugins');
var batch = require('../batch');

module.exports = (User) => {
	User.delete = (callerUid, uid, callback) => {
		if (!parseInt(uid, 10)) {
			return callback(new Error('[[error:invalid-uid]]'));
		}

		async.waterfall([
			(next) => {
				deletePosts(callerUid, uid, next);
			},
			(next) => {
				deleteTopics(callerUid, uid, next);
			},
			(next) => {
				User.deleteAccount(uid, next);
			},
		], callback);
	};

	function deletePosts(callerUid, uid, callback) {
		batch.processSortedSet('uid:' + uid + ':posts', (ids, next) => {
			async.eachSeries(ids, (pid, next) => {
				posts.purge(pid, callerUid, next);
			}, next);
		}, { alwaysStartAt: 0 }, callback);
	}

	function deleteTopics(callerUid, uid, callback) {
		batch.processSortedSet('uid:' + uid + ':topics', (ids, next) => {
			async.eachSeries(ids, (tid, next) => {
				topics.purge(tid, callerUid, next);
			}, next);
		}, { alwaysStartAt: 0 }, callback);
	}

	User.deleteAccount = (uid, callback) => {
		var userData;
		async.waterfall([
			(next) => {
				User.exists(uid, next);
			},
			(exists, next) => {
				if (!exists) {
					return callback();
				}
				User.getUserFields(uid, ['username', 'userslug', 'fullname', 'email'], next);
			},
			(_userData, next) => {
				userData = _userData;
				plugins.fireHook('static:user.delete', { uid: uid }, next);
			},
			(next) => {
				deleteVotes(uid, next);
			},
			(next) => {
				deleteChats(uid, next);
			},
			(next) => {
				User.auth.revokeAllSessions(uid, next);
			},
			(next) => {
				async.parallel([
					(next) => {
						db.sortedSetRemove('username:uid', userData.username, next);
					},
					(next) => {
						db.sortedSetRemove('username:sorted', userData.username.toLowerCase() + ':' + uid, next);
					},
					(next) => {
						db.sortedSetRemove('userslug:uid', userData.userslug, next);
					},
					(next) => {
						db.sortedSetRemove('fullname:uid', userData.fullname, next);
					},
					(next) => {
						if (userData.email) {
							async.parallel([
								async.apply(db.sortedSetRemove, 'email:uid', userData.email.toLowerCase()),
								async.apply(db.sortedSetRemove, 'email:sorted', userData.email.toLowerCase() + ':' + uid),
							], next);
						} else {
							next();
						}
					},
					(next) => {
						db.sortedSetsRemove([
							'users:joindate',
							'users:postcount',
							'users:reputation',
							'users:banned',
							'users:online',
							'users:notvalidated',
							'digest:day:uids',
							'digest:week:uids',
							'digest:month:uids',
						], uid, next);
					},
					(next) => {
						db.decrObjectField('global', 'userCount', next);
					},
					(next) => {
						var keys = [
							'uid:' + uid + ':notifications:read',
							'uid:' + uid + ':notifications:unread',
							'uid:' + uid + ':bookmarks',
							'uid:' + uid + ':followed_tids',
							'uid:' + uid + ':ignored_tids',
							'user:' + uid + ':settings',
							'uid:' + uid + ':topics', 'uid:' + uid + ':posts',
							'uid:' + uid + ':chats', 'uid:' + uid + ':chats:unread',
							'uid:' + uid + ':chat:rooms', 'uid:' + uid + ':chat:rooms:unread',
							'uid:' + uid + ':upvote', 'uid:' + uid + ':downvote',
							'uid:' + uid + ':ignored:cids', 'uid:' + uid + ':flag:pids',
							'uid:' + uid + ':sessions', 'uid:' + uid + ':sessionUUID:sessionId',
						];
						db.deleteAll(keys, next);
					},
					(next) => {
						deleteUserIps(uid, next);
					},
					(next) => {
						deleteUserFromFollowers(uid, next);
					},
					(next) => {
						groups.leaveAllGroups(uid, next);
					},
				], next);
			},
			(results, next) => {
				db.deleteAll(['followers:' + uid, 'following:' + uid, 'user:' + uid], next);
			},
		], callback);
	};

	function deleteVotes(uid, callback) {
		async.waterfall([
			(next) => {
				async.parallel({
					upvotedPids: async.apply(db.getSortedSetRange, 'uid:' + uid + ':upvote', 0, -1),
					downvotedPids: async.apply(db.getSortedSetRange, 'uid:' + uid + ':downvote', 0, -1),
				}, next);
			},
			(pids, next) => {
				pids = _.uniq(pids.upvotedPids.concat(pids.downvotedPids).filter(Boolean));

				async.eachSeries(pids, (pid, next) => {
					posts.unvote(pid, uid, next);
				}, next);
			},
		], (err) => {
			callback(err);
		});
	}

	function deleteChats(uid, callback) {
		async.waterfall([
			(next) => {
				db.getSortedSetRange('uid:' + uid + ':chat:rooms', 0, -1, next);
			},
			(roomIds, next) => {
				var userKeys = roomIds.map(roomId => (
					'uid:' + uid + ':chat:room:' + roomId + ':mids'
				));
				var roomKeys = roomIds.map(roomId => 'chat:room:' + roomId + ':uids');

				async.parallel([
					async.apply(db.sortedSetsRemove, roomKeys, uid),
					async.apply(db.deleteAll, userKeys),
				], next);
			},
		], (err) => {
			callback(err);
		});
	}

	function deleteUserIps(uid, callback) {
		async.waterfall([
			(next) => {
				db.getSortedSetRange('uid:' + uid + ':ip', 0, -1, next);
			},
			(ips, next) => {
				var keys = ips.map(ip => 'ip:' + ip + ':uid');
				db.sortedSetsRemove(keys, uid, next);
			},
			(next) => {
				db.delete('uid:' + uid + ':ip', next);
			},
		], callback);
	}

	function deleteUserFromFollowers(uid, callback) {
		async.parallel({
			followers: async.apply(db.getSortedSetRange, 'followers:' + uid, 0, -1),
			following: async.apply(db.getSortedSetRange, 'following:' + uid, 0, -1),
		}, (err, results) => {
			function updateCount(uids, name, fieldName, next) {
				async.each(uids, (uid, next) => {
					db.sortedSetCard(name + uid, (err, count) => {
						if (err) {
							return next(err);
						}
						count = parseInt(count, 10) || 0;
						db.setObjectField('user:' + uid, fieldName, count, next);
					});
				}, next);
			}

			if (err) {
				return callback(err);
			}

			var followingSets = results.followers.map(uid => 'following:' + uid);

			var followerSets = results.following.map(uid => 'followers:' + uid);

			async.parallel([
				async.apply(db.sortedSetsRemove, followerSets.concat(followingSets), uid),
				async.apply(updateCount, results.following, 'followers:', 'followerCount'),
				async.apply(updateCount, results.followers, 'following:', 'followingCount'),
			], callback);
		});
	}
};
