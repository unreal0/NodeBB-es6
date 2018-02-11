var async = require('async');

var db = require('../../database');
var user = require('../../user');
var posts = require('../../posts');
var privileges = require('../../privileges');
var meta = require('../../meta');
var helpers = require('./helpers');

module.exports = (SocketPosts) => {
	SocketPosts.getVoters = (socket, data, callback) => {
		if (!data || !data.pid || !data.cid) {
			return callback(new Error('[[error:invalid-data]]'));
		}

		async.waterfall([
			(next) => {
				if (parseInt(meta.config.votesArePublic, 10) !== 0) {
					return next(null, true);
				}
				privileges.categories.isAdminOrMod(data.cid, socket.uid, next);
			},
			(isAdminOrMod, next) => {
				if (!isAdminOrMod) {
					return next(new Error('[[error:no-privileges]]'));
				}

				async.parallel({
					upvoteUids: (next) => {
						db.getSetMembers('pid:' + data.pid + ':upvote', next);
					},
					downvoteUids: (next) => {
						db.getSetMembers('pid:' + data.pid + ':downvote', next);
					},
				}, next);
			},
			(results, next) => {
				async.parallel({
					upvoters: (next) => {
						user.getUsersFields(results.upvoteUids, ['username', 'userslug', 'picture'], next);
					},
					upvoteCount: (next) => {
						next(null, results.upvoteUids.length);
					},
					downvoters: (next) => {
						user.getUsersFields(results.downvoteUids, ['username', 'userslug', 'picture'], next);
					},
					downvoteCount: (next) => {
						next(null, results.downvoteUids.length);
					},
				}, next);
			},
		], callback);
	};

	SocketPosts.getUpvoters = (socket, pids, callback) => {
		if (!Array.isArray(pids)) {
			return callback(new Error('[[error:invalid-data]]'));
		}

		async.waterfall([
			(next) => {
				posts.getUpvotedUidsByPids(pids, next);
			},
			(data, next) => {
				if (!data.length) {
					return callback(null, []);
				}

				async.map(data, (uids, next) => {
					var otherCount = 0;
					if (uids.length > 6) {
						otherCount = uids.length - 5;
						uids = uids.slice(0, 5);
					}
					user.getUsernamesByUids(uids, (err, usernames) => {
						next(err, {
							otherCount: otherCount,
							usernames: usernames,
						});
					});
				}, next);
			},
		], callback);
	};

	SocketPosts.upvote = (socket, data, callback) => {
		helpers.postCommand(socket, 'upvote', 'voted', 'notifications:upvoted_your_post_in', data, callback);
	};

	SocketPosts.downvote = (socket, data, callback) => {
		helpers.postCommand(socket, 'downvote', 'voted', '', data, callback);
	};

	SocketPosts.unvote = (socket, data, callback) => {
		helpers.postCommand(socket, 'unvote', 'voted', '', data, callback);
	};
};
