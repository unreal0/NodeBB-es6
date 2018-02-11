var db = require('../../database');

var async = require('async');
var winston = require('winston');

module.exports = {
	name: 'Dismiss flags from deleted topics',
	timestamp: Date.UTC(2016, 3, 29),
	method: (callback) => {
		var posts = require('../../posts');
		var topics = require('../../topics');

		var pids;
		var tids;

		async.waterfall([
			async.apply(db.getSortedSetRange, 'posts:flagged', 0, -1),
			(_pids, next) => {
				pids = _pids;
				posts.getPostsFields(pids, ['tid'], next);
			},
			(_tids, next) => {
				tids = _tids.map(a => (a.tid));

				topics.getTopicsFields(tids, ['deleted'], next);
			},
			(state, next) => {
				var toDismiss = state.map((a, idx) => (parseInt(a.deleted, 10) === 1 ? pids[idx] : null)).filter(Boolean);

				winston.verbose('[2016/04/29] ' + toDismiss.length + ' dismissable flags found');
				async.each(toDismiss, dismissFlag, next);
			},
		], callback);
	},
};

// copied from core since this function was removed
// https://github.com/NodeBB/NodeBB/blob/v1.x.x/src/posts/flags.js
function dismissFlag(pid, callback) {
	async.waterfall([
		(next) => {
			db.getObjectFields('post:' + pid, ['pid', 'uid', 'flags'], next);
		},
		(postData, next) => {
			if (!postData.pid) {
				return callback();
			}
			async.parallel([
				(next) => {
					if (parseInt(postData.uid, 10)) {
						if (parseInt(postData.flags, 10) > 0) {
							async.parallel([
								async.apply(db.sortedSetIncrBy, 'users:flags', -postData.flags, postData.uid),
								async.apply(db.incrObjectFieldBy, 'user:' + postData.uid, 'flags', -postData.flags),
							], next);
						} else {
							next();
						}
					} else {
						next();
					}
				},
				(next) => {
					db.sortedSetsRemove([
						'posts:flagged',
						'posts:flags:count',
						'uid:' + postData.uid + ':flag:pids',
					], pid, next);
				},
				(next) => {
					async.series([
						(next) => {
							db.getSortedSetRange('pid:' + pid + ':flag:uids', 0, -1, (err, uids) => {
								if (err) {
									return next(err);
								}

								async.each(uids, (uid, next) => {
									var nid = 'post_flag:' + pid + ':uid:' + uid;
									async.parallel([
										async.apply(db.delete, 'notifications:' + nid),
										async.apply(db.sortedSetRemove, 'notifications', 'post_flag:' + pid + ':uid:' + uid),
									], next);
								}, next);
							});
						},
						async.apply(db.delete, 'pid:' + pid + ':flag:uids'),
					], next);
				},
				async.apply(db.deleteObjectField, 'post:' + pid, 'flags'),
				async.apply(db.delete, 'pid:' + pid + ':flag:uid:reason'),
				async.apply(db.deleteObjectFields, 'post:' + pid, ['flag:state', 'flag:assignee', 'flag:notes', 'flag:history']),
			], next);
		},
		(results, next) => {
			db.sortedSetsRemoveRangeByScore(['users:flags'], '-inf', 0, next);
		},
	], callback);
}
