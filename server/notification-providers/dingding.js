const NotificationProvider = require("./notification-provider");
const { DOWN, UP } = require("../../src/util");
const { default: axios } = require("axios");
const Crypto = require("crypto");

class DingDing extends NotificationProvider {
    name = "DingDing";

    /**
     * @inheritdoc
     */
    async send(notification, msg, monitorJSON = null, heartbeatJSON = null) {
        const okMsg = "Sent Successfully.";
        const mentionAll = notification.mentioning === "everyone";
        const mobileList = notification.mentioning === "specify-mobiles" ? notification.mobileList : [];
        const userList = notification.mentioning === "specify-users" ? notification.userList : [];
        const finalList = [...(mobileList || []), ...(userList || [])];
        const mentionStr = finalList.length > 0 ? "\n" : "" + finalList.map((item) => `@${item}`).join(" ");
        try {
            // Get uptime location from API
            let location = process.env.UPTIME_LOCATION || "位置未配置"
            
            if (heartbeatJSON != null) {
                let params = {
                    msgtype: "markdown",
                    markdown: {
                        title: `[${this.statusToString(heartbeatJSON["status"])}] ${monitorJSON["name"]}`,
                        text: `## [${this.statusToString(heartbeatJSON["status"])}] ${monitorJSON["pathName"]} \n> ${heartbeatJSON["msg"]}\n\n 时间: ${heartbeatJSON["localDateTime"]}(${heartbeatJSON["timezone"]})\n\nHost/Port: ${monitorJSON["hostname"]}:${monitorJSON["port"]}\n\nURL: ${monitorJSON["url"]}\n\n描述: ${monitorJSON["description"]}\n\n监控点: ${location}\n`,
                    },
                    at: {
                        isAtAll: mentionAll,
                        atUserIds: userList,
                        atMobiles: mobileList,
                    },
                };
                if (await this.sendToDingDing(notification, params)) {
                    return okMsg;
                }
            } else {
                let params = {
                    msgtype: "text",
                    text: {
                        content: `${msg}${mentionStr}`,
                    },
                    at: {
                        isAtAll: mentionAll,
                        atUserIds: userList,
                        atMobiles: mobileList,
                    },
                };
                if (await this.sendToDingDing(notification, params)) {
                    return okMsg;
                }
            }
        } catch (error) {
            this.throwGeneralAxiosError(error);
        }
    }

    /**
     * Send message to DingDing
     * @param {BeanModel} notification Notification to send
     * @param {object} params Parameters of message
     * @returns {Promise<boolean>} True if successful else false
     */
    async sendToDingDing(notification, params) {
        let timestamp = Date.now();

        let config = {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            url: `${notification.webHookUrl}&timestamp=${timestamp}&sign=${encodeURIComponent(this.sign(timestamp, notification.secretKey))}`,
            data: JSON.stringify(params),
        };
        config = this.getAxiosConfigWithProxy(config);

        let result = await axios(config);
        if (result.data.errmsg === "ok") {
            return true;
        }
        throw new Error(result.data.errmsg);
    }

    /**
     * DingDing sign
     * @param {Date} timestamp Timestamp of message
     * @param {string} secretKey Secret key to sign data with
     * @returns {string} Base64 encoded signature
     */
    sign(timestamp, secretKey) {
        return Crypto.createHmac("sha256", Buffer.from(secretKey, "utf8"))
            .update(Buffer.from(`${timestamp}\n${secretKey}`, "utf8"))
            .digest("base64");
    }

    /**
     * Convert status constant to string
     * @param {const} status The status constant
     * @returns {string} Status
     */
    statusToString(status) {
        switch (status) {
            case DOWN:
                return "DOWN";
            case UP:
                return "UP";
            default:
                return status;
        }
    }
}

module.exports = DingDing;
