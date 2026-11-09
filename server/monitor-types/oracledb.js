const { MonitorType } = require("./monitor-type");
const { log, UP } = require("../../src/util");
const dayjs = require("dayjs");
const oracledb = require("oracledb");
const { ConditionVariable } = require("../monitor-conditions/variables");
const { defaultStringOperators } = require("../monitor-conditions/operators");
const { ConditionExpressionGroup } = require("../monitor-conditions/expression");
const { evaluateExpressionGroup } = require("../monitor-conditions/evaluator");

class OracleDbMonitorType extends MonitorType {
    name = "oracledb";

    supportsConditions = true;
    conditionVariables = [new ConditionVariable("result", defaultStringOperators)];

    /**
     * Get the active Oracle connection mode.
     *
     * Defaults to thin mode so regular Oracle DB monitoring works without local
     * Oracle client libraries. Set ORACLE_CONNECTION_MODE=thick to force the OCI
     * client path for environments that require the local Oracle client.
     *
     * @returns {"thin"|"thick"}
     */
    getConnectionMode() {
        const mode = (process.env.ORACLE_CONNECTION_MODE || "thin").trim().toLowerCase();
        return mode === "thick" ? "thick" : "thin";
    }

    /**
     * Resolve the local Oracle client library path for thick mode.
     *
     * This is required when the target Oracle system only accepts OCI/thick connections.
     *
     * @returns {{libDir?: string}|undefined}
     */
    getOracleClientInitConfig() {
        const libDir = process.env.ORACLE_HOME || process.env.ORACLE_CLIENT_LIB_DIR;
        return libDir ? { libDir } : undefined;
    }

    /**
     * Preserve the original Oracle thin connection string as entered by the user.
     *
     * node-oracledb accepts Easy Connect strings like "host:port/service_name"
     * directly in thin mode, so we should not re-parse or strip them here.
     *
     * @param {string} connectionString The Oracle DB connection string.
     * @param {string} username Oracle DB username.
     * @param {string} password Oracle DB password.
     * @returns {{connectString: string, user: string, password: string}}
     */
    buildThinConnectionConfig(connectionString, username, password) {
        const normalizedConnectString = (connectionString || "").trim();
        return {
            connectString: normalizedConnectString,
            user: (username || "").trim(),
            password: (password || "").trim(),
        };
    }

    /**
     * Build the appropriate connection object for either thin or thick mode.
     *
     * @param {string} connectionString The Oracle DB connection string.
     * @param {string} username Oracle DB username.
     * @param {string} password Oracle DB password.
     * @returns {{connectString?: string, host?: string, port?: number, serviceName?: string, user: string, password: string}}
     */
    getConnectionOptions(connectionString, username, password) {
        if (this.getConnectionMode() === "thick") {
            return {
                connectString: (connectionString || "").trim(),
                user: (username || "").trim(),
                password: (password || "").trim(),
            };
        }

        return this.buildThinConnectionConfig(connectionString, username, password);
    }

    /**
     * Initialize Oracle's thick client if the local library is available.
     *
     * @returns {void}
     */
    initializeOracleClient() {
        if (this.getConnectionMode() !== "thick" || typeof oracledb.initOracleClient !== "function") {
            return;
        }

        try {
            const config = this.getOracleClientInitConfig();
            if (config) {
                oracledb.initOracleClient(config);
            } else {
                oracledb.initOracleClient();
            }
        } catch (error) {
            if (error && error.message && error.message.includes("already initialized")) {
                return;
            }
            throw error;
        }
    }

    /**
     * @inheritdoc
     */
    async check(monitor, heartbeat, _server) {
        let query = monitor.databaseQuery;
        if (!query || (typeof query === "string" && query.trim() === "")) {
            query = "SELECT 1 FROM DUAL";
        }

        const conditions = monitor.conditions ? ConditionExpressionGroup.fromMonitor(monitor) : null;
        const hasConditions = conditions && conditions.children && conditions.children.length > 0;

        const startTime = dayjs().valueOf();
        try {
            if (hasConditions) {
                const result = await this.oracledbQuerySingleValue(
                    monitor.databaseConnectionString,
                    query,
                    monitor.basic_auth_user,
                    monitor.basic_auth_pass
                );
                heartbeat.ping = dayjs().valueOf() - startTime;

                const conditionsResult = evaluateExpressionGroup(conditions, { result: String(result) });

                if (!conditionsResult) {
                    throw new Error(`Query result did not meet the specified conditions (${result})`);
                }

                heartbeat.status = UP;
                heartbeat.msg = "Query did meet specified conditions";
            } else {
                const result = await this.oracledbQuery(
                    monitor.databaseConnectionString,
                    query,
                    monitor.basic_auth_user,
                    monitor.basic_auth_pass
                );
                heartbeat.ping = dayjs().valueOf() - startTime;
                heartbeat.status = UP;
                heartbeat.msg = result;
            }
        } catch (error) {
            heartbeat.ping = dayjs().valueOf() - startTime;
            if (error.message.includes("did not meet the specified conditions")) {
                throw error;
            }
            throw new Error(`Database connection/query failed: ${error.message}`);
        }
    }

    /**
     * Run a query on Oracle Database.
     * @param {string} connectionString The Oracle DB connection string
     * @param {string} query The query to execute
     * @param {string} username Oracle DB username
     * @param {string} password Oracle DB password
     * @returns {Promise<string>} Row count or execution message
     */
    async oracledbQuery(connectionString, query, username, password) {
        let connection;
        try {
            this.initializeOracleClient();
            connection = await oracledb.getConnection(this.getConnectionOptions(connectionString, username, password));
            const result = await connection.execute(query, [], {
                outFormat: oracledb.OUT_FORMAT_OBJECT,
            });

            if (Array.isArray(result.rows)) {
                return `Rows: ${result.rows.length}`;
            }

            if (typeof result.rowsAffected === "number") {
                return `Rows affected: ${result.rowsAffected}`;
            }

            return "Query executed successfully";
        } catch (error) {
            log.debug(this.name, "Error caught in the query execution.", error.message);
            throw error;
        } finally {
            if (connection) {
                await connection.close();
            }
        }
    }

    /**
     * Run a query on Oracle Database expecting a single value result.
     * @param {string} connectionString The Oracle DB connection string
     * @param {string} query The query to execute
     * @param {string} username Oracle DB username
     * @param {string} password Oracle DB password
     * @returns {Promise<any>} Single value from the first column of the first row
     */
    async oracledbQuerySingleValue(connectionString, query, username, password) {
        let connection;
        try {
            this.initializeOracleClient();
            connection = await oracledb.getConnection(this.getConnectionOptions(connectionString, username, password));
            const result = await connection.execute(query, [], {
                outFormat: oracledb.OUT_FORMAT_OBJECT,
            });

            if (!result.rows || result.rows.length === 0) {
                throw new Error("Query returned no results");
            }

            if (result.rows.length > 1) {
                throw new Error("Multiple values were found, expected only one value");
            }

            const firstRow = result.rows[0];
            const columnNames = Object.keys(firstRow);

            if (columnNames.length > 1) {
                throw new Error("Multiple columns were found, expected only one value");
            }

            return firstRow[columnNames[0]];
        } catch (error) {
            log.debug(this.name, "Error caught in the query execution.", error.message);
            throw error;
        } finally {
            if (connection) {
                await connection.close();
            }
        }
    }
}

module.exports = {
    OracleDbMonitorType,
};
