// Make it Divisible by 25 (Codeforces, rating 900)
// https://codeforces.com/problemset/problem/1593/B
// Accepted 23/10/2026

#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int t;
    cin >> t;

    while(t--){
        string n;
        cin >> n;

        
        int ans = INT_MAX;

        for(int i=(int)n.size()-1;i>=0;i--){
            char target1, target2;
            if(n[i] == '0'){
                target1 = '0';
                target2='5';
                for(int j=i-1;j>=0;j--){
                    if(n[j] == target1 || n[j] == target2){
                        int deletions = (int)n.size()-i-1+i-j-1;
                        ans = min(ans, deletions);
                        break;
                    }
                }
            }
            else if(n[i] == '5'){
                target1 = '2';
                target2='7';
                for(int j=i-1;j>=0;j--){
                    if(n[j] == target1 || n[j] == target2){
                        int deletions = (int)n.size()-i-1+i-j-1;
                        ans = min(ans, deletions);
                        break;
                    }  
                }
            }
            
            


        }

        cout << ans << endl;

    }


    return 0;
}
