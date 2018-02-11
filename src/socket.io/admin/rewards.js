var rewardsAdmin = require('../../rewards/admin');
var SocketRewards = module.exports;

SocketRewards.save = (socket, data, callback) => {
	rewardsAdmin.save(data, callback);
};

SocketRewards.delete = (socket, data, callback) => {
	rewardsAdmin.delete(data, callback);
};

