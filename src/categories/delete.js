

var async = require('async');
var db = require('../database');
var batch = require('../batch');
var plugins = require('../plugins');
var topics = require('../topics');
var groups = require('../groups');
var privileges = require('../privileges');

module.exports = (Categories) => {
	Categories.purge = (cid, uid, callback) => {
		async.waterfall([
			(next) => {
				batch.processSortedSet('cid:' + cid + ':tids', (tids, next) => {
					async.eachLimit(tids, 10, (tid, next) => {
						topics.purgePostsAndTopic(tid, uid, next);
					}, next);
				}, { alwaysStartAt: 0 }, next);
			},
			(next) => {
				db.getSortedSetRevRange('cid:' + cid + ':tids:pinned', 0, -1, next);
			},
			(pinnedTids, next) => {
				async.eachLimit(pinnedTids, 10, (tid, next) => {
					topics.purgePostsAndTopic(tid, uid, next);
				}, next);
			},
			(next) => {
				purgeCategory(cid, next);
			},
			(next) => {
				plugins.fireHook('action:category.delete', { cid: cid, uid: uid });
				next();
			},
		], callback);
	};

	function purgeCategory(cid, callback) {
		async.series([
			(next) => {
				db.sortedSetRemove('categories:cid', cid, next);
			},
			(next) => {
				removeFromParent(cid, next);
			},
			(next) => {
				db.deleteAll([
					'cid:' + cid + ':tids',
					'cid:' + cid + ':tids:pinned',
					'cid:' + cid + ':tids:posts',
					'cid:' + cid + ':pids',
					'cid:' + cid + ':read_by_uid',
					'cid:' + cid + ':ignorers',
					'cid:' + cid + ':children',
					'cid:' + cid + ':tag:whitelist',
					'category:' + cid,
				], next);
			},
			(next) => {
				async.eachSeries(privileges.privilegeList, (privilege, next) => {
					groups.destroy('cid:' + cid + ':privileges:' + privilege, next);
				}, next);
			},
		], (err) => {
			callback(err);
		});
	}

	function removeFromParent(cid, callback) {
		async.waterfall([
			(next) => {
				async.parallel({
					parentCid: (next) => {
						Categories.getCategoryField(cid, 'parentCid', next);
					},
					children: (next) => {
						db.getSortedSetRange('cid:' + cid + ':children', 0, -1, next);
					},
				}, next);
			},
			(results, next) => {
				async.parallel([
					(next) => {
						results.parentCid = parseInt(results.parentCid, 10) || 0;
						db.sortedSetRemove('cid:' + results.parentCid + ':children', cid, next);
					},
					(next) => {
						async.each(results.children, (cid, next) => {
							async.parallel([
								(next) => {
									db.setObjectField('category:' + cid, 'parentCid', 0, next);
								},
								(next) => {
									db.sortedSetAdd('cid:0:children', cid, cid, next);
								},
							], next);
						}, next);
					},
				], next);
			},
		], (err) => {
			callback(err);
		});
	}
};
