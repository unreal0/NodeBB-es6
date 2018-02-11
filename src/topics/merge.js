var async = require('async');

module.exports = (Topics) => {
	Topics.merge = (tids, uid, callback) => {
		var mergeIntoTid = findOldestTopic(tids);

		var otherTids = tids.filter(tid => tid && parseInt(tid, 10) !== parseInt(mergeIntoTid, 10));

		async.eachSeries(otherTids, (tid, next) => {
			async.waterfall([
				(next) => {
					Topics.getPids(tid, next);
				},
				(pids, next) => {
					async.eachSeries(pids, (pid, next) => {
						Topics.movePostToTopic(pid, mergeIntoTid, next);
					}, next);
				},
				(next) => {
					Topics.setTopicField(tid, 'mainPid', 0, next);
				},
				(next) => {
					Topics.delete(tid, uid, next);
				},
			], next);
		}, callback);
	};

	function findOldestTopic(tids) {
		return Math.min.apply(null, tids);
	}
};
