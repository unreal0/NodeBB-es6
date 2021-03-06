var async = require('async');

var meta = require('../meta');
var db = require('../database');
var user = require('../user');
var plugins = require('../plugins');
var privileges = require('../privileges');

module.exports = (Posts) => {
	var votesInProgress = {};

	Posts.upvote = (pid, uid, callback) => {
		if (parseInt(meta.config['reputation:disabled'], 10) === 1) {
			return callback(new Error('[[error:reputation-system-disabled]]'));
		}

		async.waterfall([
			(next) => {
				privileges.posts.can('posts:upvote', pid, uid, next);
			},
			(canUpvote, next) => {
				if (!canUpvote) {
					return next(new Error('[[error:no-privileges]]'));
				}

				if (voteInProgress(pid, uid)) {
					return next(new Error('[[error:already-voting-for-this-post]]'));
				}

				putVoteInProgress(pid, uid);

				toggleVote('upvote', pid, uid, (err, data) => {
					clearVoteProgress(pid, uid);
					next(err, data);
				});
			},
		], callback);
	};

	Posts.downvote = (pid, uid, callback) => {
		if (parseInt(meta.config['reputation:disabled'], 10) === 1) {
			return callback(new Error('[[error:reputation-system-disabled]]'));
		}

		if (parseInt(meta.config['downvote:disabled'], 10) === 1) {
			return callback(new Error('[[error:downvoting-disabled]]'));
		}

		async.waterfall([
			(next) => {
				privileges.posts.can('posts:downvote', pid, uid, next);
			},
			(canUpvote, next) => {
				if (!canUpvote) {
					return next(new Error('[[error:no-privileges]]'));
				}

				if (voteInProgress(pid, uid)) {
					return next(new Error('[[error:already-voting-for-this-post]]'));
				}

				putVoteInProgress(pid, uid);

				toggleVote('downvote', pid, uid, (err, data) => {
					clearVoteProgress(pid, uid);
					next(err, data);
				});
			},
		], callback);
	};

	Posts.unvote = (pid, uid, callback) => {
		if (voteInProgress(pid, uid)) {
			return callback(new Error('[[error:already-voting-for-this-post]]'));
		}

		putVoteInProgress(pid, uid);

		unvote(pid, uid, 'unvote', (err, data) => {
			clearVoteProgress(pid, uid);
			callback(err, data);
		});
	};

	Posts.hasVoted = (pid, uid, callback) => {
		if (!parseInt(uid, 10)) {
			return callback(null, { upvoted: false, downvoted: false });
		}
		async.waterfall([
			(next) => {
				db.isMemberOfSets(['pid:' + pid + ':upvote', 'pid:' + pid + ':downvote'], uid, next);
			},
			(hasVoted, next) => {
				next(null, { upvoted: hasVoted[0], downvoted: hasVoted[1] });
			},
		], callback);
	};

	Posts.getVoteStatusByPostIDs = (pids, uid, callback) => {
		if (!parseInt(uid, 10)) {
			var data = pids.map(() => false);
			return callback(null, { upvotes: data, downvotes: data });
		}
		var upvoteSets = [];
		var downvoteSets = [];

		for (var i = 0; i < pids.length; i += 1) {
			upvoteSets.push('pid:' + pids[i] + ':upvote');
			downvoteSets.push('pid:' + pids[i] + ':downvote');
		}

		async.parallel({
			upvotes: (next) => {
				db.isMemberOfSets(upvoteSets, uid, next);
			},
			downvotes: (next) => {
				db.isMemberOfSets(downvoteSets, uid, next);
			},
		}, callback);
	};

	Posts.getUpvotedUidsByPids = (pids, callback) => {
		var sets = pids.map(pid => 'pid:' + pid + ':upvote');
		db.getSetsMembers(sets, callback);
	};

	function voteInProgress(pid, uid) {
		return Array.isArray(votesInProgress[uid]) && votesInProgress[uid].includes(parseInt(pid, 10));
	}

	function putVoteInProgress(pid, uid) {
		votesInProgress[uid] = votesInProgress[uid] || [];
		votesInProgress[uid].push(parseInt(pid, 10));
	}

	function clearVoteProgress(pid, uid) {
		if (Array.isArray(votesInProgress[uid])) {
			var index = votesInProgress[uid].indexOf(parseInt(pid, 10));
			if (index !== -1) {
				votesInProgress[uid].splice(index, 1);
			}
		}
	}

	function toggleVote(type, pid, uid, callback) {
		async.waterfall([
			(next) => {
				unvote(pid, uid, type, (err) => {
					next(err);
				});
			},
			(next) => {
				vote(type, false, pid, uid, next);
			},
		], callback);
	}

	function unvote(pid, uid, command, callback) {
		async.waterfall([
			(next) => {
				async.parallel({
					owner: (next) => {
						Posts.getPostField(pid, 'uid', next);
					},
					voteStatus: (next) => {
						Posts.hasVoted(pid, uid, next);
					},
					reputation: (next) => {
						user.getUserField(uid, 'reputation', next);
					},
				}, next);
			},
			(results, next) => {
				if (parseInt(uid, 10) === parseInt(results.owner, 10)) {
					return callback(new Error('[[error:self-vote]]'));
				}

				if (command === 'downvote' && parseInt(results.reputation, 10) < parseInt(meta.config['min:rep:downvote'], 10)) {
					return callback(new Error('[[error:not-enough-reputation-to-downvote]]'));
				}

				var voteStatus = results.voteStatus;
				var hook;
				var current = voteStatus.upvoted ? 'upvote' : 'downvote';

				if ((voteStatus.upvoted && command === 'downvote') || (voteStatus.downvoted && command === 'upvote')) {	// e.g. User *has* upvoted, and clicks downvote
					hook = command;
				} else if (voteStatus.upvoted || voteStatus.downvoted) {	// e.g. User *has* upvoted, clicks upvote (so we "unvote")
					hook = 'unvote';
				} else {	// e.g. User *has not* voted, clicks upvote
					hook = command;
					current = 'unvote';
				}

				plugins.fireHook('action:post.' + hook, {
					pid: pid,
					uid: uid,
					owner: results.owner,
					current: current,
				});

				if (!voteStatus || (!voteStatus.upvoted && !voteStatus.downvoted)) {
					return callback();
				}

				vote(voteStatus.upvoted ? 'downvote' : 'upvote', true, pid, uid, next);
			},
		], callback);
	}

	function vote(type, unvote, pid, uid, callback) {
		uid = parseInt(uid, 10);

		if (!uid) {
			return callback(new Error('[[error:not-logged-in]]'));
		}
		var postData;
		var newreputation;
		async.waterfall([
			(next) => {
				Posts.getPostFields(pid, ['pid', 'uid', 'tid'], next);
			},
			(_postData, next) => {
				postData = _postData;
				var now = Date.now();

				if (type === 'upvote' && !unvote) {
					db.sortedSetAdd('uid:' + uid + ':upvote', now, pid);
				} else {
					db.sortedSetRemove('uid:' + uid + ':upvote', pid);
				}

				if (type === 'upvote' || unvote) {
					db.sortedSetRemove('uid:' + uid + ':downvote', pid);
				} else {
					db.sortedSetAdd('uid:' + uid + ':downvote', now, pid);
				}

				user[type === 'upvote' ? 'incrementUserFieldBy' : 'decrementUserFieldBy'](postData.uid, 'reputation', 1, next);
			},
			(_newreputation, next) => {
				newreputation = _newreputation;
				if (parseInt(postData.uid, 10)) {
					db.sortedSetAdd('users:reputation', newreputation, postData.uid);
				}

				adjustPostVotes(postData, uid, type, unvote, next);
			},
			(next) => {
				next(null, {
					user: {
						reputation: newreputation,
					},
					fromuid: uid,
					post: postData,
					upvote: type === 'upvote' && !unvote,
					downvote: type === 'downvote' && !unvote,
				});
			},
		], callback);
	}

	function adjustPostVotes(postData, uid, type, unvote, callback) {
		var notType = (type === 'upvote' ? 'downvote' : 'upvote');
		async.waterfall([
			(next) => {
				async.series([
					(next) => {
						if (unvote) {
							db.setRemove('pid:' + postData.pid + ':' + type, uid, next);
						} else {
							db.setAdd('pid:' + postData.pid + ':' + type, uid, next);
						}
					},
					(next) => {
						db.setRemove('pid:' + postData.pid + ':' + notType, uid, next);
					},
				], (err) => {
					next(err);
				});
			},
			(next) => {
				async.parallel({
					upvotes: (next) => {
						db.setCount('pid:' + postData.pid + ':upvote', next);
					},
					downvotes: (next) => {
						db.setCount('pid:' + postData.pid + ':downvote', next);
					},
				}, next);
			},
			(results, next) => {
				postData.upvotes = parseInt(results.upvotes, 10);
				postData.downvotes = parseInt(results.downvotes, 10);
				postData.votes = postData.upvotes - postData.downvotes;
				Posts.updatePostVoteCount(postData, next);
			},
		], callback);
	}
};
