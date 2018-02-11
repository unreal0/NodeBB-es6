var db = require('../database');
var plugins = require('../plugins');
var async = require('async');

var rewards = module.exports;

rewards.checkConditionAndRewardUser = (uid, condition, method, callback) => {
	callback = callback || function () {};

	async.waterfall([
		(next) => {
			isConditionActive(condition, next);
		},
		(isActive, next) => {
			if (!isActive) {
				return callback();
			}
			getIDsByCondition(condition, next);
		},
		(ids, next) => {
			getRewardDataByIDs(ids, next);
		},
		(rewards, next) => {
			filterCompletedRewards(uid, rewards, next);
		},
		(rewards, next) => {
			if (!rewards || !rewards.length) {
				return callback();
			}

			async.filter(rewards, (reward, next) => {
				if (!reward) {
					return next(null, false);
				}

				checkCondition(reward, method, next);
			}, (err, eligible) => {
				if (err || !eligible) {
					return next(false);
				}

				giveRewards(uid, eligible, next);
			});
		},
	], callback);
};

function isConditionActive(condition, callback) {
	db.isSetMember('conditions:active', condition, callback);
}

function getIDsByCondition(condition, callback) {
	db.getSetMembers('condition:' + condition + ':rewards', callback);
}

function filterCompletedRewards(uid, rewards, callback) {
	async.waterfall([
		(next) => {
			db.getSortedSetRangeByScoreWithScores('uid:' + uid + ':rewards', 0, -1, 1, '+inf', next);
		},
		(data, next) => {
			var userRewards = {};

			data.forEach((obj) => {
				userRewards[obj.value] = parseInt(obj.score, 10);
			});

			rewards = rewards.filter((reward) => {
				if (!reward) {
					return false;
				}

				var claimable = parseInt(reward.claimable, 10);
				return claimable === 0 || (!userRewards[reward.id] || userRewards[reward.id] < reward.claimable);
			});

			next(null, rewards);
		},
	], callback);
}

function getRewardDataByIDs(ids, callback) {
	db.getObjects(ids.map(id => 'rewards:id:' + id), callback);
}

function getRewardsByRewardData(rewards, callback) {
	db.getObjects(rewards.map(reward => 'rewards:id:' + reward.id + ':rewards'), callback);
}

function checkCondition(reward, method, callback) {
	async.waterfall([
		(next) => {
			method(next);
		},
		(value, next) => {
			plugins.fireHook('filter:rewards.checkConditional:' + reward.conditional, { left: value, right: reward.value }, next);
		},
		(bool, next) => {
			next(null, bool);
		},
	], callback);
}

function giveRewards(uid, rewards, callback) {
	async.waterfall([
		(next) => {
			getRewardsByRewardData(rewards, next);
		},
		(rewardData, next) => {
			async.each(rewards, (reward, next) => {
				plugins.fireHook('action:rewards.award:' + reward.rid, { uid: uid, reward: rewardData[rewards.indexOf(reward)] });
				db.sortedSetIncrBy('uid:' + uid + ':rewards', 1, reward.id, next);
			}, next);
		},
	], callback);
}
