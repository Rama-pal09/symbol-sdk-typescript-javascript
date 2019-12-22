/*
 * Copyright 2019 NEM
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Observable, of } from 'rxjs';
import { flatMap, map, mergeMap, toArray } from 'rxjs/operators';
import { IListener } from '../infrastructure/IListener';
import { NamespaceId } from '../model/namespace/NamespaceId';
import { AccountAddressRestrictionTransaction } from '../model/transaction/AccountAddressRestrictionTransaction';
import { AggregateTransaction } from '../model/transaction/AggregateTransaction';
import { LockFundsTransaction } from '../model/transaction/LockFundsTransaction';
import { MosaicAddressRestrictionTransaction } from '../model/transaction/MosaicAddressRestrictionTransaction';
import { MosaicGlobalRestrictionTransaction } from '../model/transaction/MosaicGlobalRestrictionTransaction';
import { MosaicMetadataTransaction } from '../model/transaction/MosaicMetadataTransaction';
import { MosaicSupplyChangeTransaction } from '../model/transaction/MosaicSupplyChangeTransaction';
import { SecretLockTransaction } from '../model/transaction/SecretLockTransaction';
import { SecretProofTransaction } from '../model/transaction/SecretProofTransaction';
import { SignedTransaction } from '../model/transaction/SignedTransaction';
import { Transaction } from '../model/transaction/Transaction';
import { TransactionType } from '../model/transaction/TransactionType';
import { TransferTransaction } from '../model/transaction/TransferTransaction';
import { ITransactionService } from './interfaces/ITransactionService';
import { TransactionRepository } from "../infrastructure/TransactionRepository";
import { ReceiptRepository } from "../infrastructure/ReceiptRepository";

/**
 * Transaction Service
 */
export class TransactionService implements ITransactionService {

    /**
     * Constructor
     * @param transactionRepository
     * @param receiptRepository
     */
    constructor(private readonly transactionRepository: TransactionRepository,
                private readonly receiptRepository: ReceiptRepository) {
    }

    /**
     * Resolve unresolved mosaic / address from array of transactions
     * @param transationHashes List of transaction hashes.
     * @param listener Websocket listener
     * @returns Observable<Transaction[]>
     */
    public resolveAliases(transationHashes: string[]): Observable<Transaction[]> {
        return this.transactionRepository.getTransactions(transationHashes).pipe(
            mergeMap((_) => _),
            mergeMap((transaction) => this.resolveTransaction(transaction)),
            toArray(),
        );
    }

    /**
     * @param signedTransaction Signed transaction to be announced.
     * @param listener Websocket listener
     * @returns {Observable<Transaction>}
     */
    public announce(signedTransaction: SignedTransaction, listener: IListener): Observable<Transaction> {
        return this.transactionRepository.announce(signedTransaction).pipe(
            flatMap(() => listener.confirmed(signedTransaction.getSignerAddress(), signedTransaction.hash)),
        );
    }

    /**
     * Announce aggregate transaction
     * **NOTE** A lock fund transaction for this aggregate bonded should exists
     * @param signedTransaction Signed aggregate bonded transaction.
     * @param listener Websocket listener
     * @returns {Observable<AggregateTransaction>}
     */
    public announceAggregateBonded(signedTransaction: SignedTransaction, listener: IListener): Observable<AggregateTransaction> {
        return this.transactionRepository.announceAggregateBonded(signedTransaction).pipe(
            flatMap(() => listener.aggregateBondedAdded(signedTransaction.getSignerAddress(), signedTransaction.hash)),
        );
    }

    /**
     * Announce aggregate bonded transaction with lock fund
     * @param signedHashLockTransaction Signed hash lock transaction.
     * @param signedAggregateTransaction Signed aggregate bonded transaction.
     * @param listener Websocket listener
     * @returns {Observable<AggregateTransaction>}
     */
    public announceHashLockAggregateBonded(signedHashLockTransaction: SignedTransaction,
                                           signedAggregateTransaction: SignedTransaction,
                                           listener: IListener): Observable<AggregateTransaction> {
        return this.announce(signedHashLockTransaction, listener).pipe(
            flatMap(() => this.announceAggregateBonded(signedAggregateTransaction, listener)),
        );

    }

    /**
     * Resolve transaction alias(s)
     * @param transaction Transaction to be resolved
     * @returns {Observable<Transaction>}
     */
    private resolveTransaction(transaction: Transaction): Observable<Transaction> {
        if ([TransactionType.AGGREGATE_BONDED, TransactionType.AGGREGATE_COMPLETE].includes(transaction.type)) {
            if ((transaction as AggregateTransaction).innerTransactions.find((tx) => this.checkShouldResolve((tx as Transaction)))) {
                return this.resolvedFromReceipt(transaction, transaction.transactionInfo!.index);
            }
            return of(transaction);
        }
        return this.checkShouldResolve(transaction) ? this.resolvedFromReceipt(transaction, 0) : of(transaction);
    }

    /**
     * @internal
     * Check if receiptRepository needs to be called to resolve transaction alias
     * @param transaction Transaction
     * @return {boolean}
     */
    private checkShouldResolve(transaction: Transaction): boolean {
        switch (transaction.type) {
            case TransactionType.LINK_ACCOUNT:
            case TransactionType.ACCOUNT_METADATA_TRANSACTION:
            case TransactionType.ACCOUNT_RESTRICTION_OPERATION:
            case TransactionType.ADDRESS_ALIAS:
            case TransactionType.MOSAIC_ALIAS:
            case TransactionType.MOSAIC_DEFINITION:
            case TransactionType.MODIFY_MULTISIG_ACCOUNT:
            case TransactionType.NAMESPACE_METADATA_TRANSACTION:
            case TransactionType.REGISTER_NAMESPACE:
                return false;
            case TransactionType.ACCOUNT_RESTRICTION_ADDRESS:
                const accountAddressRestriction = transaction as AccountAddressRestrictionTransaction;
                return accountAddressRestriction.restrictionAdditions.find((address) => address instanceof NamespaceId) !== undefined ||
                    accountAddressRestriction.restrictionDeletions.find((address) => address instanceof NamespaceId) !== undefined;
            case TransactionType.ACCOUNT_RESTRICTION_MOSAIC:
                const accountMosaicRestriction = transaction as AccountAddressRestrictionTransaction;
                return accountMosaicRestriction.restrictionAdditions.find((mosaicId) => mosaicId instanceof NamespaceId) !== undefined ||
                    accountMosaicRestriction.restrictionDeletions.find((mosaicId) => mosaicId instanceof NamespaceId) !== undefined;
            case TransactionType.LOCK:
                return (transaction as LockFundsTransaction).mosaic.id instanceof NamespaceId;
            case TransactionType.MOSAIC_ADDRESS_RESTRICTION:
                const mosaicAddressRestriction = transaction as MosaicAddressRestrictionTransaction;
                return mosaicAddressRestriction.targetAddress instanceof NamespaceId ||
                    mosaicAddressRestriction.mosaicId instanceof NamespaceId;
            case TransactionType.MOSAIC_GLOBAL_RESTRICTION:
                const mosaicGlobalRestriction = transaction as MosaicGlobalRestrictionTransaction;
                return mosaicGlobalRestriction.referenceMosaicId instanceof NamespaceId ||
                    mosaicGlobalRestriction.mosaicId instanceof NamespaceId;
            case TransactionType.MOSAIC_METADATA_TRANSACTION:
                return (transaction as MosaicMetadataTransaction).targetMosaicId instanceof NamespaceId;
            case TransactionType.MOSAIC_SUPPLY_CHANGE:
                return (transaction as MosaicSupplyChangeTransaction).mosaicId instanceof NamespaceId;
            case TransactionType.SECRET_PROOF:
                return (transaction as SecretProofTransaction).recipientAddress instanceof NamespaceId;
            case TransactionType.SECRET_LOCK:
                const secretLock = transaction as SecretLockTransaction;
                return secretLock.recipientAddress instanceof NamespaceId ||
                    secretLock.mosaic.id instanceof NamespaceId;
            case TransactionType.TRANSFER:
                const transfer = transaction as TransferTransaction;
                return transfer.recipientAddress instanceof NamespaceId ||
                    transfer.mosaics.find((mosaic) => mosaic.id instanceof NamespaceId) !== undefined;
            default:
                throw new Error('Transaction type not not recogonised.');
        }
    }

    /**
     * @internal
     * Resolve transaction alais(s) from block receipt by calling receiptRepository
     * @param transaction Transaction to be resolved
     * @param aggregateIndex Aggregate transaction index
     * @return {Observable<Transaction>}
     */
    private resolvedFromReceipt(transaction: Transaction, aggregateIndex: number): Observable<Transaction> {
        return this.receiptRepository.getBlockReceipts(transaction.transactionInfo!.height.toString()).pipe(
            map((statement) => transaction.resolveAliases(statement, aggregateIndex)),
        );
    }
}
