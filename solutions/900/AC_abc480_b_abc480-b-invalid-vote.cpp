// ABC480 B - Invalid Vote (AtCoder, rating 950)
// https://atcoder.jp/contests/abc480/tasks/abc480_b
// Accepted 25/10/2026

#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int n; // number of candidates
    cin >> n;

    int m; // number of ballots
    cin >> m;

    vector<string> candidates(n);

    for(int i=0;i<n;i++){
        cin >> candidates[i];
    }

    vector<int> votes(n, 0);

    int emi = -1; // exact match index
    int nnm=0; // number of near matches
    int nmi=-1; // near match index

    
    for(int i=0;i<m;i++){
        string ballot;
        cin >> ballot;

        // check if the ballot name matches against any candidate
        // 

        for(int j=0;j<n;j++){
            if(ballot == candidates[j]){
                emi=j;
                break;
            }
            else if(ballot.length() == candidates[j].length()){
                int mismatches=0;

                for(int k=0;k<ballot.length(); k++){
                    if(ballot[k] != candidates[j][k]){
                        mismatches++;
                    }
                    if(mismatches>1){
                        break;
                    }
                    
                }

                if(mismatches == 1){
                    nnm++;
                    nmi=j;
                }

            }        

        }

        if(emi>=0){
            votes[emi]++;
        }
        else if(nnm==1){
            votes[nmi]++;
        }

        emi=-1;
        nnm=0;
        nmi=-1;

    }

    for(int i=0; i<n;i++){
        cout << votes[i] << endl;
    }



    return 0;
}
